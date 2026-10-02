using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);

var supabaseUrl = (builder.Configuration["SUPABASE_URL"] ?? "").TrimEnd('/');
var supabaseKey = builder.Configuration["SUPABASE_PUBLISHABLE_KEY"] ?? "";
var auditDocsUrl = (builder.Configuration["AUDIT_DOCS_URL"] ?? "https://app-sgq-docs.onrender.com").TrimEnd('/');

if (string.IsNullOrWhiteSpace(supabaseUrl) || string.IsNullOrWhiteSpace(supabaseKey))
    throw new InvalidOperationException("SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY são obrigatórios.");

builder.Services.AddHttpClient("supabase", c => c.Timeout = TimeSpan.FromSeconds(75));
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("https://app-sgq.onrender.com", "http://localhost:5173", "http://127.0.0.1:5173")
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();
app.UseCors();

string Token(HttpRequest request)
{
    var raw = request.Headers.Authorization.ToString();
    if (!raw.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        throw new UnauthorizedAccessException("Authorization Bearer obrigatório.");
    return raw["Bearer ".Length..].Trim();
}

void ApplyAuth(HttpRequestMessage req, string token)
{
    req.Headers.TryAddWithoutValidation("apikey", supabaseKey);
    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
}

string EncodedPath(string path) =>
    string.Join("/", path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Uri.EscapeDataString));

string JsonValue(JsonElement value)
{
    return value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? "",
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => value.GetRawText()
    };
}

string InValue(JsonElement value)
{
    if (value.ValueKind != JsonValueKind.Array) return $"({JsonValue(value)})";
    var parts = new List<string>();
    foreach (var item in value.EnumerateArray())
    {
        if (item.ValueKind == JsonValueKind.String)
        {
            var s = item.GetString() ?? "";
            if (s.IndexOfAny([',','(',')','"']) >= 0)
                s = "\"" + s.Replace("\"", "\\\"") + "\"";
            parts.Add(s);
        }
        else parts.Add(JsonValue(item));
    }
    return $"({string.Join(",", parts)})";
}

object Error(string message, string? detail = null) => new
{
    data = (object?)null,
    error = new { message, details = detail ?? "" },
    count = (long?)null
};


async Task<JsonElement?> RestAsync(
    HttpClient client,
    string token,
    HttpMethod method,
    string table,
    string query = "",
    object? body = null,
    string? prefer = null)
{
    var url = $"{supabaseUrl}/rest/v1/{table}" + (string.IsNullOrWhiteSpace(query) ? "" : "?" + query);
    var msg = new HttpRequestMessage(method, url);
    ApplyAuth(msg, token);
    msg.Headers.TryAddWithoutValidation("Accept", "application/json");
    if (!string.IsNullOrWhiteSpace(prefer)) msg.Headers.TryAddWithoutValidation("Prefer", prefer);
    if (body is not null)
        msg.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    var res = await client.SendAsync(msg);
    var raw = await res.Content.ReadAsStringAsync();
    if (!res.IsSuccessStatusCode)
        throw new InvalidOperationException($"{table}: HTTP {(int)res.StatusCode} - {raw}");

    if (string.IsNullOrWhiteSpace(raw)) return null;
    using var doc = JsonDocument.Parse(raw);
    return doc.RootElement.Clone();
}

async Task<string> CurrentUserId(HttpClient client, string token)
{
    var msg = new HttpRequestMessage(HttpMethod.Get, $"{supabaseUrl}/auth/v1/user");
    ApplyAuth(msg, token);
    var res = await client.SendAsync(msg);
    var raw = await res.Content.ReadAsStringAsync();
    if (!res.IsSuccessStatusCode) throw new UnauthorizedAccessException("Sessão inválida ou expirada.");
    using var doc = JsonDocument.Parse(raw);
    return doc.RootElement.GetProperty("id").GetString() ?? throw new UnauthorizedAccessException("Usuário inválido.");
}

(JsonElement? row, bool found) FirstRow(JsonElement? element)
{
    if (element is null || element.Value.ValueKind != JsonValueKind.Array || element.Value.GetArrayLength() == 0)
        return (null, false);
    return (element.Value[0].Clone(), true);
}

(string Code, int Sample, int? Ac, int? Re) SamplingPlan(long lot, string level)
{
    if (lot <= 0) return ("", 0, null, null);
    if (lot < 281) return ("100%", (int)Math.Min(lot, int.MaxValue), 0, 1);

    var rows = new (long Min,long Max,string I,string II,string S2)[] {
        (281,500,"F","H","C"),(501,1200,"G","J","C"),(1201,3200,"H","K","D"),
        (3201,10000,"J","L","D"),(10001,35000,"K","M","D"),(35001,150000,"L","N","E"),
        (150001,500000,"M","P","E"),(500001,long.MaxValue,"N","Q","E")
    };
    var sizes = new Dictionary<string,int> {
        ["A"]=2,["B"]=3,["C"]=5,["D"]=8,["E"]=13,["F"]=20,["G"]=32,["H"]=50,
        ["J"]=80,["K"]=125,["L"]=200,["M"]=315,["N"]=500,["P"]=800,["Q"]=1250,["R"]=2000
    };
    var acre = new Dictionary<string,(int Ac,int Re)> {
        ["F"]=(1,2),["G"]=(1,2),["H"]=(2,3),["J"]=(3,4),["K"]=(5,6),
        ["L"]=(7,8),["M"]=(10,11),["N"]=(14,15),["P"]=(21,22)
    };
    var row = rows.FirstOrDefault(x => lot >= x.Min && lot <= x.Max);
    var code = level switch { "II" => row.II, "S2" => row.S2, _ => row.I };
    var sample = sizes.TryGetValue(code ?? "", out var s) ? s : 0;
    if (level == "S2") return (code ?? "", sample, null, null);
    return acre.TryGetValue(code ?? "", out var ar) ? (code ?? "", sample, ar.Ac, ar.Re) : (code ?? "", sample, null, null);
}

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "sgq-api",
    architecture = "react -> aspnet -> supabase",
    utc = DateTimeOffset.UtcNow
}));

app.MapGet("/api/me", async (HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        var msg = new HttpRequestMessage(HttpMethod.Get, $"{supabaseUrl}/auth/v1/user");
        ApplyAuth(msg, token);
        var res = await factory.CreateClient("supabase").SendAsync(msg);
        var raw = await res.Content.ReadAsStringAsync();
        return Results.Text(raw, "application/json", statusCode: (int)res.StatusCode);
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
});

app.MapPost("/api/produtos/consultar", async (ProductLookupRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var code=(input.Codigo??"").Trim();
        if(string.IsNullOrWhiteSpace(code)) return Results.Json(Error("Código do produto obrigatório."),statusCode:400);
        var client=factory.CreateClient("supabase");

        var fn=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/omie-produto");
        ApplyAuth(fn,token);
        fn.Content=JsonContent.Create(new {codigo=code});
        var fnRes=await client.SendAsync(fn);
        var raw=await fnRes.Content.ReadAsStringAsync();
        JsonElement omie;
        try{using var doc=JsonDocument.Parse(raw);omie=doc.RootElement.Clone();}
        catch{return Results.Json(Error("Resposta inválida da integração OMIE.",raw),statusCode:502);}

        if(!fnRes.IsSuccessStatusCode)
            return Results.Ok(new {data=new {found=false,error="integration_error",message=raw},error=(object?)null});

        if(omie.TryGetProperty("error",out var omieError)&&omieError.ValueKind==JsonValueKind.String)
        {
            var err=omieError.GetString();
            var msg=omie.TryGetProperty("message",out var me)&&me.ValueKind==JsonValueKind.String?me.GetString():"Falha ao consultar o OMIE.";
            return Results.Ok(new {data=new {found=false,error=err,message=msg},error=(object?)null});
        }

        var found=omie.TryGetProperty("found",out var fd)&&fd.ValueKind==JsonValueKind.True;
        var descricao=omie.TryGetProperty("descricao",out var de)&&de.ValueKind==JsonValueKind.String?de.GetString():null;
        if(!found||string.IsNullOrWhiteSpace(descricao))
            return Results.Ok(new {data=new {found=false,error="not_found",message="Código não localizado no cadastro de produtos do OMIE."},error=(object?)null});

        var productRows=await RestAsync(client,token,HttpMethod.Get,"produtos",
            $"select=id,foto_principal_path&sku=eq.{Uri.EscapeDataString(code)}&limit=1");
        var (product,pf)=FirstRow(productRows);
        string productId;
        string? photoPath=null;
        if(pf)
        {
            productId=product!.Value.GetProperty("id").GetString()!;
            if(product.Value.TryGetProperty("foto_principal_path",out var fp)&&fp.ValueKind==JsonValueKind.String) photoPath=fp.GetString();
            await RestAsync(client,token,HttpMethod.Patch,"produtos",$"id=eq.{Uri.EscapeDataString(productId)}",new {nome=descricao},"return=minimal");
        }
        else
        {
            var created=await RestAsync(client,token,HttpMethod.Post,"produtos","select=id,foto_principal_path",
                new {sku=code,nome=descricao},"return=representation");
            var (pr,createdFound)=FirstRow(created);
            if(!createdFound) throw new InvalidOperationException("Falha ao cadastrar produto local.");
            productId=pr!.Value.GetProperty("id").GetString()!;
            if(pr.Value.TryGetProperty("foto_principal_path",out var fp)&&fp.ValueKind==JsonValueKind.String) photoPath=fp.GetString();
        }

        string? photoUrl=null;
        if(!string.IsNullOrWhiteSpace(photoPath))
        {
            var sign=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/storage/v1/object/sign/produto-fotos/{EncodedPath(photoPath)}");
            ApplyAuth(sign,token);
            sign.Content=JsonContent.Create(new {expiresIn=3600});
            var signRes=await client.SendAsync(sign);
            if(signRes.IsSuccessStatusCode)
            {
                var signRaw=await signRes.Content.ReadAsStringAsync();
                using var signDoc=JsonDocument.Parse(signRaw);
                var root=signDoc.RootElement;
                photoUrl=root.TryGetProperty("signedURL",out var su)?su.GetString():
                    root.TryGetProperty("signedUrl",out var sl)?sl.GetString():null;
                if(!string.IsNullOrWhiteSpace(photoUrl)&&photoUrl.StartsWith("/")) photoUrl=supabaseUrl+"/storage/v1"+photoUrl;
            }
        }

        var hasNc=false;
        var itemRows=await RestAsync(client,token,HttpMethod.Get,"processo_itens",$"select=id&produto_id=eq.{Uri.EscapeDataString(productId)}");
        var itemIds=itemRows is {ValueKind:JsonValueKind.Array}
            ? itemRows.Value.EnumerateArray().Select(x=>x.GetProperty("id").GetString()).Where(x=>!string.IsNullOrWhiteSpace(x)).ToList()
            : [];
        if(itemIds.Count>0)
        {
            var inItems=string.Join(",",itemIds);
            var linkRows=await RestAsync(client,token,HttpMethod.Get,"grupo_inspecao_itens",$"select=grupo_inspecao_id&processo_item_id=in.({inItems})");
            var groupIds=linkRows is {ValueKind:JsonValueKind.Array}
                ? linkRows.Value.EnumerateArray().Select(x=>x.GetProperty("grupo_inspecao_id").GetString()).Where(x=>!string.IsNullOrWhiteSpace(x)).Distinct().ToList()
                : [];
            if(groupIds.Count>0)
            {
                var inGroups=string.Join(",",groupIds);
                var insRows=await RestAsync(client,token,HttpMethod.Get,"inspecoes",$"select=id&grupo_inspecao_id=in.({inGroups})&excluido_em=is.null");
                var insIds=insRows is {ValueKind:JsonValueKind.Array}
                    ? insRows.Value.EnumerateArray().Select(x=>x.GetProperty("id").GetString()).Where(x=>!string.IsNullOrWhiteSpace(x)).ToList()
                    : [];
                if(insIds.Count>0)
                {
                    var inIns=string.Join(",",insIds);
                    var ncRows=await RestAsync(client,token,HttpMethod.Get,"inspecao_nao_conformidades",$"select=id&inspecao_id=in.({inIns})&limit=1");
                    hasNc=ncRows is {ValueKind:JsonValueKind.Array}&&ncRows.Value.GetArrayLength()>0;
                }
            }
        }

        return Results.Ok(new {data=new {
            found=true,
            descricao,
            productId,
            fotoPrincipalPath=photoPath,
            fotoPreview=photoUrl,
            hasNcHistory=hasNc,
            message=hasNc?"Produto confirmado no OMIE. Há histórico de NC; Nível II é recomendado.":"Produto confirmado no OMIE."
        },error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao consultar produto.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/criar", async (CreateInspectionRequest input, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        var client = factory.CreateClient("supabase");
        var userId = await CurrentUserId(client, token);

        var processCode = Regex.Replace(input.Codigo ?? "", "\\D", "");
        if (!Regex.IsMatch(processCode, "^\\d{5}$"))
            return Results.Json(Error("O Processo FST deve ter exatamente 5 números."), statusCode: 400);
        if (string.IsNullOrWhiteSpace(input.Cliente) || input.DataInspecao == default)
            return Results.Json(Error("Cliente e data da inspeção são obrigatórios."), statusCode: 400);
        if (string.IsNullOrWhiteSpace(input.ItVersionId))
            return Results.Json(Error("Selecione a IT aplicável."), statusCode: 400);
        if (input.Itens is null || input.Itens.Count == 0)
            return Results.Json(Error("Informe ao menos um produto."), statusCode: 400);

        foreach (var item in input.Itens)
        {
            if (string.IsNullOrWhiteSpace(item.Sku) || string.IsNullOrWhiteSpace(item.Nome))
                return Results.Json(Error("Todos os produtos precisam de código e descrição."), statusCode: 400);
            if (item.Quantidade <= 0 || item.CaixasRecebidas <= 0 || item.CaixasInspecionadas <= 0)
                return Results.Json(Error($"{item.Sku}: quantidades e caixas devem ser maiores que zero."), statusCode: 400);

            if (item.DistribuicaoCaixas is { Count: > 0 })
            {
                var boxes = item.DistribuicaoCaixas.Sum(x => x.Caixas);
                var units = item.DistribuicaoCaixas.Sum(x => x.Caixas * x.Unidades);
                if (Math.Abs(boxes - item.CaixasRecebidas) > 0.0001m)
                    return Results.Json(Error($"{item.Sku}: a distribuição soma {boxes} caixas e o total informado é {item.CaixasRecebidas}."), statusCode: 400);
                if (Math.Abs(units - item.Quantidade) > 0.0001m)
                    return Results.Json(Error($"{item.Sku}: a distribuição soma {units} unidades e a quantidade recebida é {item.Quantidade}."), statusCode: 400);
            }
        }

        var statisticalLot = input.Itens
            .Select(x => (long)Math.Floor(x.Quantidade / Math.Max(x.UnidadesPorConjunto <= 0 ? 1m : x.UnidadesPorConjunto, 0.000001m)))
            .Where(x => x > 0)
            .DefaultIfEmpty(0)
            .Min();
        if (statisticalLot <= 0)
            return Results.Json(Error("Não foi possível calcular o lote estatístico."), statusCode: 400);

        var level = string.IsNullOrWhiteSpace(input.InspectionLevel) ? "I" : input.InspectionLevel;
        var plan = SamplingPlan(statisticalLot, level);

        var existingProcessRows = await RestAsync(client, token, HttpMethod.Get, "processos",
            $"select=id&codigo=eq.{Uri.EscapeDataString(processCode)}&excluido_em=is.null&limit=1");
        var (existingProcess, hasProcess) = FirstRow(existingProcessRows);
        string processId;

        if (hasProcess)
        {
            processId = existingProcess!.Value.GetProperty("id").GetString()!;
            await RestAsync(client, token, HttpMethod.Patch, "processos",
                $"id=eq.{Uri.EscapeDataString(processId)}",
                new {
                    cliente = input.Cliente.Trim(),
                    nota_fiscal = string.IsNullOrWhiteSpace(input.NotaFiscal) ? null : input.NotaFiscal.Trim(),
                    origem = string.IsNullOrWhiteSpace(input.Origem) ? null : input.Origem.Trim(),
                    transporte = string.IsNullOrWhiteSpace(input.Transporte) ? null : input.Transporte.Trim(),
                    chegada_cd = input.ChegadaCd,
                    status = "em_inspecao",
                    atualizado_em = DateTimeOffset.UtcNow
                }, "return=minimal");
        }
        else
        {
            var created = await RestAsync(client, token, HttpMethod.Post, "processos", "select=id",
                new {
                    codigo = processCode,
                    cliente = input.Cliente.Trim(),
                    nota_fiscal = string.IsNullOrWhiteSpace(input.NotaFiscal) ? null : input.NotaFiscal.Trim(),
                    origem = string.IsNullOrWhiteSpace(input.Origem) ? null : input.Origem.Trim(),
                    transporte = string.IsNullOrWhiteSpace(input.Transporte) ? null : input.Transporte.Trim(),
                    chegada_cd = input.ChegadaCd,
                    status = "em_inspecao",
                    data_processo = input.DataInspecao,
                    criado_por = userId
                }, "return=representation");
            var (row, found) = FirstRow(created);
            if (!found) throw new InvalidOperationException("Falha ao criar processo.");
            processId = row!.Value.GetProperty("id").GetString()!;
        }

        var groupsRows = await RestAsync(client, token, HttpMethod.Get, "grupos_inspecao",
            $"select=id&processo_id=eq.{Uri.EscapeDataString(processId)}");
        var groupCount = groupsRows is { ValueKind: JsonValueKind.Array } ? groupsRows.Value.GetArrayLength() : 0;
        var groupCode = $"G{groupCount + 1:00}";
        var groupName = string.Join(" + ", input.Itens.Select(x => x.Nome.Trim()));
        var isComponentSet = input.Itens.Count > 1;

        var createdGroup = await RestAsync(client, token, HttpMethod.Post, "grupos_inspecao", "select=id",
            new {
                processo_id = processId,
                codigo = groupCode,
                nome = groupName,
                tipo = isComponentSet ? "kit_componentes" : "individual",
                tamanho_lote_estatistico = statisticalLot,
                status = "em_inspecao"
            }, "return=representation");
        var (groupRow, groupFound) = FirstRow(createdGroup);
        if (!groupFound) throw new InvalidOperationException("Falha ao criar grupo de inspeção.");
        var groupId = groupRow!.Value.GetProperty("id").GetString()!;

        string? firstItemId = null;
        foreach (var item in input.Itens)
        {
            var productRows = await RestAsync(client, token, HttpMethod.Get, "produtos",
                $"select=id,nome,foto_principal_path&sku=eq.{Uri.EscapeDataString(item.Sku.Trim())}&limit=1");
            var (productRow, productFound) = FirstRow(productRows);
            string productId;

            if (productFound)
            {
                productId = productRow!.Value.GetProperty("id").GetString()!;
                await RestAsync(client, token, HttpMethod.Patch, "produtos",
                    $"id=eq.{Uri.EscapeDataString(productId)}",
                    new {
                        nome = item.Nome.Trim(),
                        foto_principal_path = string.IsNullOrWhiteSpace(item.FotoPrincipalPath)
                            ? (productRow.Value.TryGetProperty("foto_principal_path", out var fp) && fp.ValueKind != JsonValueKind.Null ? fp.GetString() : null)
                            : item.FotoPrincipalPath
                    }, "return=minimal");
            }
            else
            {
                var productCreated = await RestAsync(client, token, HttpMethod.Post, "produtos", "select=id",
                    new {
                        sku = item.Sku.Trim(),
                        nome = item.Nome.Trim(),
                        foto_principal_path = string.IsNullOrWhiteSpace(item.FotoPrincipalPath) ? null : item.FotoPrincipalPath
                    }, "return=representation");
                var (pr, pf) = FirstRow(productCreated);
                if (!pf) throw new InvalidOperationException($"Falha ao cadastrar produto {item.Sku}.");
                productId = pr!.Value.GetProperty("id").GetString()!;
            }

            var itemCreated = await RestAsync(client, token, HttpMethod.Post, "processo_itens", "select=id",
                new {
                    processo_id = processId,
                    produto_id = productId,
                    codigo_cliente = (string?)null,
                    lote = string.IsNullOrWhiteSpace(item.Lote) ? null : item.Lote.Trim(),
                    material = string.IsNullOrWhiteSpace(item.Material) ? null : item.Material.Trim(),
                    capacidade = string.IsNullOrWhiteSpace(item.Capacidade) ? null : item.Capacidade.Trim(),
                    quantidade = item.Quantidade,
                    quantidade_por_caixa = item.QuantidadePorCaixa > 0 ? item.QuantidadePorCaixa : null,
                    caixas_recebidas = item.CaixasRecebidas,
                    caixas_inspecionadas = item.CaixasInspecionadas,
                    distribuicao_caixas = item.DistribuicaoCaixas is { Count: > 0 } ? item.DistribuicaoCaixas : null
                }, "return=representation");
            var (ir, inf) = FirstRow(itemCreated);
            if (!inf) throw new InvalidOperationException($"Falha ao cadastrar item {item.Sku}.");
            var itemId = ir!.Value.GetProperty("id").GetString()!;
            firstItemId ??= itemId;

            await RestAsync(client, token, HttpMethod.Post, "grupo_inspecao_itens", "",
                new {
                    grupo_inspecao_id = groupId,
                    processo_item_id = itemId,
                    quantidade_componente = item.Quantidade,
                    unidades_por_conjunto = item.UnidadesPorConjunto <= 0 ? 1m : item.UnidadesPorConjunto
                }, "return=minimal");
        }

        await RestAsync(client, token, HttpMethod.Post, "grupo_inspecao_its", "",
            new { grupo_inspecao_id = groupId, it_versao_id = input.ItVersionId, principal = true },
            "return=minimal");

        var inspectionNumber = $"INS-{DateTime.UtcNow.Year}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString()[^7..]}";
        var totalBoxesReceived = input.Itens.Sum(x => x.CaixasRecebidas);
        var totalBoxesInspect = input.Itens.Sum(x => x.CaixasInspecionadas);

        var createdInspection = await RestAsync(client, token, HttpMethod.Post, "inspecoes", "select=id",
            new {
                numero = inspectionNumber,
                processo_item_id = firstItemId,
                grupo_inspecao_id = groupId,
                it_versao_id = input.ItVersionId,
                status = "em_andamento",
                resultado = "pendente",
                tamanho_lote = statisticalLot,
                tamanho_amostra = plan.Sample,
                limite_aceitacao = plan.Ac,
                limite_rejeicao = plan.Re,
                nivel_inspecao = level,
                nivel_inspecao_origem = "it",
                regime_inspecao = "normal",
                tipo_plano = "simples",
                codigo_amostragem = plan.Code,
                nqa_critico = 0.40m,
                nqa_grave = 1.50m,
                nqa_toleravel = 4.00m,
                caixas_recebidas = totalBoxesReceived,
                caixas_avaliar = totalBoxesInspect,
                data_inspecao = input.DataInspecao,
                responsavel_id = userId,
                iniciada_em = DateTimeOffset.UtcNow,
                parametros_amostragem = new { fonte = "backend_dotnet", regra_caixas = "informada_por_item", versao = "2026-10" }
            }, "return=representation");

        var (inspectionRow, inspectionFound) = FirstRow(createdInspection);
        if (!inspectionFound) throw new InvalidOperationException("Falha ao criar inspeção.");
        var inspectionId = inspectionRow!.Value.GetProperty("id").GetString()!;

        return Results.Ok(new {
            data = new {
                id = inspectionId,
                numero = inspectionNumber,
                processo_id = processId,
                grupo_inspecao_id = groupId,
                plano = new { codigo = plan.Code, amostra = plan.Sample, ac = plan.Ac, re = plan.Re, lote = statisticalLot }
            },
            error = (object?)null
        });
    }
    catch (UnauthorizedAccessException e)
    {
        return Results.Json(Error(e.Message), statusCode: 401);
    }
    catch (Exception e)
    {
        return Results.Json(Error("Falha ao criar inspeção no backend.", e.Message), statusCode: 500);
    }
});

app.MapGet("/api/amostragem/plano", (long lote, string? nivel) =>
{
    var plan = SamplingPlan(lote, string.IsNullOrWhiteSpace(nivel) ? "I" : nivel);
    return Results.Ok(new { data = new { codigo = plan.Code, amostra = plan.Sample, ac = plan.Ac, re = plan.Re, lote }, error = (object?)null });
});

app.MapPost("/api/inspecoes/{id}/unidades", async (string id, RegisterUnitRequest input, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);

        var existing=await RestAsync(client,token,HttpMethod.Get,"inspecao_registros",
            $"select=id,conforme&inspecao_id=eq.{Uri.EscapeDataString(id)}&order=sequencia.asc");
        var rows=existing is { ValueKind:JsonValueKind.Array } ? existing.Value.EnumerateArray().ToList() : [];
        var seq=rows.Count+1;

        var created=await RestAsync(client,token,HttpMethod.Post,"inspecao_registros","select=id",
            new { inspecao_id=id, sequencia=seq, conforme=input.Conforme },"return=representation");
        var (regRow,found)=FirstRow(created);
        if(!found) throw new InvalidOperationException("Falha ao registrar unidade.");
        var regId=regRow!.Value.GetProperty("id").GetString()!;

        if(!input.Conforme)
        {
            if(string.IsNullOrWhiteSpace(input.ChecklistId)) return Results.Json(Error("Selecione o item da IT relacionado à não conformidade."),statusCode:400);
            if(string.IsNullOrWhiteSpace(input.Descricao)) return Results.Json(Error("Descreva a não conformidade."),statusCode:400);

            await RestAsync(client,token,HttpMethod.Post,"inspecao_nao_conformidades","",
                new {
                    inspecao_id=id,
                    inspecao_registro_id=regId,
                    processo_item_id=string.IsNullOrWhiteSpace(input.ItemId)?null:input.ItemId,
                    checklist_id=input.ChecklistId,
                    descricao=input.Descricao.Trim(),
                    severidade=string.IsNullOrWhiteSpace(input.Severidade)?"grave":input.Severidade,
                    tipo="amostragem"
                },"return=minimal");

            await RestAsync(client,token,HttpMethod.Post,"inspecao_checklist_resultados",
                "on_conflict=inspecao_id,checklist_id",
                new {
                    inspecao_id=id,
                    checklist_id=input.ChecklistId,
                    resultado="nao_conforme",
                    severidade_confirmada=string.IsNullOrWhiteSpace(input.Severidade)?"grave":input.Severidade,
                    registrado_por=userId,
                    registrado_em=DateTimeOffset.UtcNow
                },"resolution=merge-duplicates,return=minimal");
        }

        var all=await RestAsync(client,token,HttpMethod.Get,"inspecao_registros",
            $"select=conforme&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var allRows=all is { ValueKind:JsonValueKind.Array } ? all.Value.EnumerateArray().ToList() : [];
        var total=allRows.Count;
        var nc=allRows.Count(x=>x.TryGetProperty("conforme",out var conf) && conf.ValueKind==JsonValueKind.False);
        var ok=total-nc;

        await RestAsync(client,token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new { total_inspecionado=total,total_conforme=ok,total_nao_conforme=nc },"return=minimal");

        var ins=await RestAsync(client,token,HttpMethod.Get,"inspecoes",
            $"select=limite_rejeicao&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        int? re=null;
        var (ir,ifound)=FirstRow(ins);
        if(ifound && ir!.Value.TryGetProperty("limite_rejeicao",out var reEl) && reEl.ValueKind==JsonValueKind.Number && reEl.TryGetInt32(out var rv)) re=rv;

        return Results.Ok(new { data=new { sequencia=seq,total,total_conforme=ok,total_nao_conforme=nc,limite_rejeicao=re,re_atingido=re.HasValue&&nc>=re.Value }, error=(object?)null });
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao registrar unidade.",e.Message),statusCode:500);}
});

app.MapPut("/api/inspecoes/{id}/checklist/{checkId}", async (string id,string checkId,ChecklistResultRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);

        if(string.IsNullOrWhiteSpace(input.Resultado))
        {
            await RestAsync(client,token,HttpMethod.Patch,"inspecao_checklist_resultados",
                $"inspecao_id=eq.{Uri.EscapeDataString(id)}&checklist_id=eq.{Uri.EscapeDataString(checkId)}",
                new { severidade_confirmada=string.IsNullOrWhiteSpace(input.Severidade)?null:input.Severidade },"return=minimal");
        }
        else
        {
            await RestAsync(client,token,HttpMethod.Post,"inspecao_checklist_resultados",
                "on_conflict=inspecao_id,checklist_id",
                new {
                    inspecao_id=id,
                    checklist_id=checkId,
                    resultado=input.Resultado,
                    severidade_confirmada=input.Resultado=="nao_conforme"?(string.IsNullOrWhiteSpace(input.Severidade)?"grave":input.Severidade):null,
                    registrado_por=userId,
                    registrado_em=DateTimeOffset.UtcNow
                },"resolution=merge-duplicates,return=minimal");
        }
        return Results.Ok(new { data=new { ok=true },error=(object?)null });
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao salvar checklist.",e.Message),statusCode:500);}
});

app.MapPut("/api/inspecoes/{id}/observacao-interna", async (string id,InternalNoteRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        await RestAsync(factory.CreateClient("supabase"),token,HttpMethod.Patch,"inspecoes",
            $"id=eq.{Uri.EscapeDataString(id)}",new { observacao_interna=string.IsNullOrWhiteSpace(input.Texto)?null:input.Texto.Trim() },"return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao salvar observação interna.",e.Message),statusCode:500);}
});

app.MapPut("/api/inspecoes/{id}/dimensionais/{itemId}/{paramId}/config", async (string id,string itemId,string paramId,DimConfigRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        decimal? min=null,max=null;
        if(input.ValorNominal.HasValue && input.DesvioMenos.HasValue) min=input.ValorNominal.Value-input.DesvioMenos.Value;
        if(input.ValorNominal.HasValue && input.DesvioMais.HasValue) max=input.ValorNominal.Value+input.DesvioMais.Value;

        var saved=await RestAsync(client,token,HttpMethod.Post,"inspecao_dimensional_configuracoes",
            "on_conflict=inspecao_id,processo_item_id,parametro_id&select=*",
            new {
                inspecao_id=id,
                processo_item_id=itemId,
                parametro_id=paramId,
                nao_aplicavel=input.NaoAplicavel,
                equipamento=input.Equipamento,
                codigo_equipamento=input.CodigoEquipamento,
                unidade=input.Unidade,
                valor_nominal=input.ValorNominal,
                desvio_menos=input.DesvioMenos,
                desvio_mais=input.DesvioMais,
                minimo_aceitavel=min,
                maximo_aceitavel=max,
                especificacao_desvio=input.EspecificacaoDesvio,
                tipo_referencia=input.TipoReferencia,
                atualizado_em=DateTimeOffset.UtcNow
            },"resolution=merge-duplicates,return=representation");
        var (row,found)=FirstRow(saved);
        return Results.Ok(new {data=found?row:(object?)null,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao salvar configuração dimensional.",e.Message),statusCode:500);}
});

app.MapPut("/api/inspecoes/{id}/dimensionais/{itemId}/{paramId}/{seq:int}", async (string id,string itemId,string paramId,int seq,DimValueRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var cfgRows=await RestAsync(client,token,HttpMethod.Get,"inspecao_dimensional_configuracoes",
            $"select=nao_aplicavel,unidade,minimo_aceitavel,maximo_aceitavel&inspecao_id=eq.{Uri.EscapeDataString(id)}&processo_item_id=eq.{Uri.EscapeDataString(itemId)}&parametro_id=eq.{Uri.EscapeDataString(paramId)}&limit=1");
        var (cfg,found)=FirstRow(cfgRows);
        if(found && cfg!.Value.TryGetProperty("nao_aplicavel",out var na) && na.ValueKind==JsonValueKind.True)
            return Results.Json(Error("Este parâmetro está marcado como não aplicável."),statusCode:409);

        decimal? min=null,max=null;
        string? unit=input.Unidade;
        if(found)
        {
            if(cfg!.Value.TryGetProperty("minimo_aceitavel",out var mn)&&mn.ValueKind==JsonValueKind.Number) min=mn.GetDecimal();
            if(cfg.Value.TryGetProperty("maximo_aceitavel",out var mx)&&mx.ValueKind==JsonValueKind.Number) max=mx.GetDecimal();
            if(string.IsNullOrWhiteSpace(unit)&&cfg.Value.TryGetProperty("unidade",out var un)&&un.ValueKind==JsonValueKind.String) unit=un.GetString();
        }
        bool? conforme=min is null&&max is null?null:(min is null||input.Valor>=min)&&(max is null||input.Valor<=max);

        var saved=await RestAsync(client,token,HttpMethod.Post,"inspecao_dimensionais",
            "on_conflict=inspecao_id,processo_item_id,parametro_id,sequencia_amostra&select=*",
            new {
                inspecao_id=id,
                processo_item_id=itemId,
                parametro_id=paramId,
                sequencia_amostra=seq,
                valor=input.Valor,
                unidade=unit,
                conforme
            },"resolution=merge-duplicates,return=representation");
        var (row,ok)=FirstRow(saved);
        return Results.Ok(new {data=ok?row:(object?)null,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao salvar medição.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/dimensionais/finalizar", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        await RestAsync(factory.CreateClient("supabase"),token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {dimensionais_finalizados=true},"return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(Exception e){return Results.Json(Error("Falha ao finalizar dimensionais.",e.Message),statusCode:500);}
});

app.MapPut("/api/inspecoes/{id}/testes/{testId}", async (string id,string testId,TestResultRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);
        await RestAsync(client,token,HttpMethod.Post,"inspecao_testes_resultados",
            "on_conflict=inspecao_id,teste_id",
            new {inspecao_id=id,teste_id=testId,resultado=input.Resultado,registrado_por=userId,registrado_em=DateTimeOffset.UtcNow},
            "resolution=merge-duplicates,return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao salvar teste.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/testes/finalizar", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        await RestAsync(factory.CreateClient("supabase"),token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {testes_finalizados=true},"return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(Exception e){return Results.Json(Error("Falha ao finalizar testes.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/concluir", async (string id,FinishInspectionRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var insRows=await RestAsync(client,token,HttpMethod.Get,"inspecoes",
            $"select=grupo_inspecao_id,it_versao_id,tamanho_amostra,total_inspecionado,total_nao_conforme,limite_rejeicao,dimensionais_finalizados,testes_finalizados&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (ins,found)=FirstRow(insRows);
        if(!found) return Results.Json(Error("Inspeção não encontrada."),statusCode:404);
        var i=ins!.Value;

        int sample=i.TryGetProperty("tamanho_amostra",out var sm)&&sm.ValueKind==JsonValueKind.Number?sm.GetInt32():0;
        int inspected=i.TryGetProperty("total_inspecionado",out var ti)&&ti.ValueKind==JsonValueKind.Number?ti.GetInt32():0;
        int nc=i.TryGetProperty("total_nao_conforme",out var tn)&&tn.ValueKind==JsonValueKind.Number?tn.GetInt32():0;
        int? re=i.TryGetProperty("limite_rejeicao",out var rr)&&rr.ValueKind==JsonValueKind.Number?rr.GetInt32():null;
        var reHit=re.HasValue&&nc>=re.Value;
        var pending=new List<string>();
        if(inspected<sample&&!reHit) pending.Add($"Amostragem incompleta: {inspected}/{sample}.");

        var itId=i.GetProperty("it_versao_id").GetString()!;
        var checks=await RestAsync(client,token,HttpMethod.Get,"it_checklist",$"select=id&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true");
        var checkResults=await RestAsync(client,token,HttpMethod.Get,"inspecao_checklist_resultados",$"select=checklist_id&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var checkCount=checks is {ValueKind:JsonValueKind.Array}?checks.Value.GetArrayLength():0;
        var checkDone=checkResults is {ValueKind:JsonValueKind.Array}?checkResults.Value.GetArrayLength():0;
        if(checkDone<checkCount) pending.Add($"{checkCount-checkDone} verificação(ões) sem preenchimento.");

        var dims=await RestAsync(client,token,HttpMethod.Get,"it_parametros_dimensionais",$"select=id&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true");
        var dimCount=dims is {ValueKind:JsonValueKind.Array}?dims.Value.GetArrayLength():0;
        var dimsDone=i.TryGetProperty("dimensionais_finalizados",out var df)&&df.ValueKind==JsonValueKind.True;
        if(dimCount>0&&!dimsDone) pending.Add("Dimensionais não marcados como concluídos.");

        var tests=await RestAsync(client,token,HttpMethod.Get,"it_testes_especiais",$"select=id&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true");
        var testResults=await RestAsync(client,token,HttpMethod.Get,"inspecao_testes_resultados",$"select=teste_id&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var testCount=tests is {ValueKind:JsonValueKind.Array}?tests.Value.GetArrayLength():0;
        var testDone=testResults is {ValueKind:JsonValueKind.Array}?testResults.Value.GetArrayLength():0;
        var testsMarked=i.TryGetProperty("testes_finalizados",out var tf)&&tf.ValueKind==JsonValueKind.True;
        if(testDone<testCount||(testCount>0&&!testsMarked)) pending.Add("Testes especiais incompletos.");

        await RestAsync(client,token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {
                status="concluida",
                resultado=input.Resultado,
                observacoes=string.IsNullOrWhiteSpace(input.Observacoes)?null:input.Observacoes.Trim(),
                justificativa_decisao=reHit?(string.IsNullOrWhiteSpace(input.Observacoes)?null:input.Observacoes.Trim()):null,
                revisao_obrigatoria=pending.Count>0||reHit,
                concluida_em=DateTimeOffset.UtcNow
            },"return=minimal");

        var groupId=i.GetProperty("grupo_inspecao_id").GetString();
        if(!string.IsNullOrWhiteSpace(groupId))
            await RestAsync(client,token,HttpMethod.Patch,"grupos_inspecao",$"id=eq.{Uri.EscapeDataString(groupId)}",new {status="concluido"},"return=minimal");

        return Results.Ok(new {data=new {pendencias=pending,re_atingido=reHit},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao concluir inspeção.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/retencao", async (string id,RetentionRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);

        var insRows=await RestAsync(client,token,HttpMethod.Get,"inspecoes",
            $"select=id,numero,grupo_inspecao_id&excluido_em=is.null&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (ins,found)=FirstRow(insRows);
        if(!found) return Results.Json(Error("Inspeção não encontrada."),statusCode:404);

        if(input.Itens is null || input.Itens.Count==0)
        {
            if(string.IsNullOrWhiteSpace(input.MotivoSemRetencao))
                return Results.Json(Error("Informe o motivo para não reter amostra."),statusCode:400);

            await RestAsync(client,token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
                new {retencao_decisao=false,retencao_motivo=input.MotivoSemRetencao.Trim()},"return=minimal");
            return Results.Ok(new {data=new {retidos=0},error=(object?)null});
        }

        var groupId=ins!.Value.GetProperty("grupo_inspecao_id").GetString()!;
        var groupRows=await RestAsync(client,token,HttpMethod.Get,"grupos_inspecao",
            $"select=processo_id&id=eq.{Uri.EscapeDataString(groupId)}&limit=1");
        var (group,gfound)=FirstRow(groupRows);
        if(!gfound) throw new InvalidOperationException("Grupo da inspeção não encontrado.");
        var processId=group!.Value.GetProperty("processo_id").GetString()!;

        var reportRows=await RestAsync(client,token,HttpMethod.Get,"laudos",
            $"select=id,numero,storage_path&inspecao_id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (report,reportFound)=FirstRow(reportRows);
        string reportId;
        if(reportFound) reportId=report!.Value.GetProperty("id").GetString()!;
        else
        {
            var createdReport=await RestAsync(client,token,HttpMethod.Post,"laudos","select=id",
                new {inspecao_id=id,numero=ins.Value.GetProperty("numero").GetString()},"return=representation");
            var (rr,rf)=FirstRow(createdReport);
            if(!rf) throw new InvalidOperationException("Falha ao vincular laudo.");
            reportId=rr!.Value.GetProperty("id").GetString()!;
        }

        var retained=0;
        foreach(var item in input.Itens)
        {
            if(item.Quantidade<=0 || string.IsNullOrWhiteSpace(item.Endereco))
                return Results.Json(Error("Quantidade e endereço são obrigatórios para retenção."),statusCode:400);
            if(string.IsNullOrWhiteSpace(item.FotoCadastroPath))
                return Results.Json(Error("Foto de cadastro é obrigatória para retenção."),statusCode:400);

            var processItemRows=await RestAsync(client,token,HttpMethod.Get,"processo_itens",
                $"select=id,produto_id,lote&processo_id=eq.{Uri.EscapeDataString(processId)}&id=eq.{Uri.EscapeDataString(item.ProcessoItemId)}&limit=1");
            var (processItem,pif)=FirstRow(processItemRows);
            if(!pif) return Results.Json(Error("Produto da inspeção não encontrado."),statusCode:404);
            var productId=processItem!.Value.GetProperty("produto_id").GetString()!;

            var alreadyRows=await RestAsync(client,token,HttpMethod.Get,"amostras",
                $"select=id&inspecao_id=eq.{Uri.EscapeDataString(id)}&produto_id=eq.{Uri.EscapeDataString(productId)}&limit=1");
            var (_,already)=FirstRow(alreadyRows);
            if(already) continue;

            var productRows=await RestAsync(client,token,HttpMethod.Get,"produtos",
                $"select=nome&id=eq.{Uri.EscapeDataString(productId)}&limit=1");
            var (product,pf)=FirstRow(productRows);
            var productName=pf && product!.Value.TryGetProperty("nome",out var pn)&&pn.ValueKind==JsonValueKind.String?pn.GetString():null;
            var lote=processItem.Value.TryGetProperty("lote",out var lt)&&lt.ValueKind==JsonValueKind.String?lt.GetString():null;
            var code=$"AMO-{DateTime.UtcNow.Year}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}";

            var createdSample=await RestAsync(client,token,HttpMethod.Post,"amostras","select=id",
                new {
                    codigo=code,
                    inspecao_id=id,
                    produto_id=productId,
                    processo_id=processId,
                    grupo_inspecao_id=groupId,
                    lote,
                    quantidade_inicial=item.Quantidade,
                    status="ativa",
                    endereco=item.Endereco.Trim(),
                    unidade_controle="unidade",
                    descricao=productName,
                    laudo_id=reportId,
                    foto_cadastro_path=item.FotoCadastroPath
                },"return=representation");
            var (sample,sf)=FirstRow(createdSample);
            if(!sf) throw new InvalidOperationException("Falha ao criar amostra retida.");
            var sampleId=sample!.Value.GetProperty("id").GetString()!;

            await RestAsync(client,token,HttpMethod.Post,"amostra_movimentacoes","",
                new {
                    amostra_id=sampleId,
                    tipo="entrada",
                    quantidade=item.Quantidade,
                    endereco_destino=item.Endereco.Trim(),
                    motivo="Retenção após finalização da inspeção",
                    usuario_id=userId
                },"return=minimal");
            retained++;
        }

        await RestAsync(client,token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {retencao_decisao=true,retencao_motivo=(string?)null},"return=minimal");

        return Results.Ok(new {data=new {retidos=retained,laudo_id=reportId},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao registrar retenção.",e.Message),statusCode:500);}
});

app.MapPost("/api/amostras/criar", async (CreateSampleRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);
        if(string.IsNullOrWhiteSpace(input.GroupId)||input.Quantidade<=0||string.IsNullOrWhiteSpace(input.Endereco))
            return Results.Json(Error("Selecione a inspeção e informe quantidade e endereço."),statusCode:400);

        var groupRows=await RestAsync(client,token,HttpMethod.Get,"grupos_inspecao",
            $"select=id,nome,processo_id&id=eq.{Uri.EscapeDataString(input.GroupId)}&limit=1");
        var (group,found)=FirstRow(groupRows);
        if(!found) return Results.Json(Error("Grupo de inspeção não encontrado."),statusCode:404);
        var code=$"AMO-{DateTime.UtcNow.Year}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}";
        var description=!string.IsNullOrWhiteSpace(input.Descricao)?input.Descricao.Trim():
            (group!.Value.TryGetProperty("nome",out var gn)&&gn.ValueKind==JsonValueKind.String?gn.GetString():null);

        var created=await RestAsync(client,token,HttpMethod.Post,"amostras","select=id",
            new {
                codigo=code,
                processo_id=group!.Value.GetProperty("processo_id").GetString(),
                grupo_inspecao_id=input.GroupId,
                produto_id=(string?)null,
                descricao=description,
                lote=string.IsNullOrWhiteSpace(input.Lote)?null:input.Lote.Trim(),
                quantidade_inicial=input.Quantidade,
                unidade_controle=string.IsNullOrWhiteSpace(input.Unidade)?"conjunto":input.Unidade,
                endereco=input.Endereco.Trim(),
                status="ativa"
            },"return=representation");
        var (sample,sf)=FirstRow(created);
        if(!sf) throw new InvalidOperationException("Falha ao criar amostra.");
        var sampleId=sample!.Value.GetProperty("id").GetString()!;

        await RestAsync(client,token,HttpMethod.Post,"amostra_movimentacoes","",
            new {
                amostra_id=sampleId,
                tipo="entrada",
                quantidade=input.Quantidade,
                endereco_destino=input.Endereco.Trim(),
                motivo="Retenção após inspeção",
                usuario_id=userId
            },"return=minimal");
        return Results.Ok(new {data=new {id=sampleId,codigo=code},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao criar amostra.",e.Message),statusCode:500);}
});

app.MapPost("/api/estoque/{sampleId}/movimentar", async (string sampleId,StockMoveRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);
        if(input.Quantidade<=0) return Results.Json(Error("Informe uma quantidade válida."),statusCode:400);
        var allowed=new HashSet<string>(StringComparer.OrdinalIgnoreCase){"retirada","descarte","transferencia","devolucao","entrada"};
        if(!allowed.Contains(input.Tipo)) return Results.Json(Error("Tipo de movimentação inválido."),statusCode:400);

        var rows=await RestAsync(client,token,HttpMethod.Get,"vw_saldo_amostras",
            $"select=id,saldo,endereco&id=eq.{Uri.EscapeDataString(sampleId)}&limit=1");
        var (sample,found)=FirstRow(rows);
        if(!found) return Results.Json(Error("Amostra não encontrada."),statusCode:404);
        var saldo=sample!.Value.TryGetProperty("saldo",out var sl)&&sl.ValueKind==JsonValueKind.Number?sl.GetDecimal():0m;
        var origin=sample.Value.TryGetProperty("endereco",out var ed)&&ed.ValueKind==JsonValueKind.String?ed.GetString():null;
        if((input.Tipo=="retirada"||input.Tipo=="descarte")&&input.Quantidade>saldo)
            return Results.Json(Error("Quantidade maior que o saldo disponível."),statusCode:400);

        var dest=string.IsNullOrWhiteSpace(input.Endereco)?origin:input.Endereco.Trim();
        await RestAsync(client,token,HttpMethod.Post,"amostra_movimentacoes","",
            new {
                amostra_id=sampleId,
                tipo=input.Tipo,
                quantidade=input.Quantidade,
                endereco_origem=origin,
                endereco_destino=(input.Tipo=="transferencia"||input.Tipo=="devolucao")?dest:null,
                motivo=string.IsNullOrWhiteSpace(input.Motivo)?null:input.Motivo.Trim(),
                usuario_id=userId
            },"return=minimal");
        if(input.Tipo=="transferencia"&&!string.IsNullOrWhiteSpace(dest))
            await RestAsync(client,token,HttpMethod.Patch,"amostras",$"id=eq.{Uri.EscapeDataString(sampleId)}",new {endereco=dest},"return=minimal");

        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao movimentar estoque.",e.Message),statusCode:500);}
});

app.MapPost("/api/its/cadastrar", async (RegisterItRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        if(string.IsNullOrWhiteSpace(input.Codigo)||string.IsNullOrWhiteSpace(input.Titulo)||string.IsNullOrWhiteSpace(input.Versao)||string.IsNullOrWhiteSpace(input.ArquivoStoragePath))
            return Results.Json(Error("Código, título, versão e arquivo são obrigatórios."),statusCode:400);

        var itRows=await RestAsync(client,token,HttpMethod.Post,"instrucoes_trabalho","on_conflict=codigo&select=id",
            new {codigo=input.Codigo.Trim(),titulo=input.Titulo.Trim(),ativo=true},
            "resolution=merge-duplicates,return=representation");
        var (it,found)=FirstRow(itRows);
        if(!found) throw new InvalidOperationException("Falha ao cadastrar IT.");
        var itId=it!.Value.GetProperty("id").GetString()!;

        var versionRows=await RestAsync(client,token,HttpMethod.Post,"it_versoes","select=id",
            new {
                instrucao_trabalho_id=itId,
                versao=input.Versao.Trim(),
                vigencia=input.Vigencia,
                status="rascunho",
                arquivo_nome=input.ArquivoNome,
                arquivo_storage_path=input.ArquivoStoragePath,
                arquivo_mime=input.ArquivoMime,
                leitura_ia_status="aguardando"
            },"return=representation");
        var (version,vf)=FirstRow(versionRows);
        if(!vf) throw new InvalidOperationException("Falha ao criar versão da IT.");
        var versionId=version!.Value.GetProperty("id").GetString()!;

        object? structure=null;
        string? structureError=null;
        try
        {
            var msg=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/estruturar-it");
            ApplyAuth(msg,token);
            msg.Content=JsonContent.Create(new {it_versao_id=versionId});
            var res=await client.SendAsync(msg);
            var raw=await res.Content.ReadAsStringAsync();
            if(res.IsSuccessStatusCode)
            {
                try{structure=JsonSerializer.Deserialize<JsonElement>(raw);}catch{structure=raw;}
            }
            else structureError=raw;
        }
        catch(Exception e){structureError=e.Message;}

        return Results.Ok(new {data=new {id=versionId,estrutura=structure,estrutura_erro=structureError},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao cadastrar IT.",e.Message),statusCode:500);}
});

app.MapPost("/api/its/{id}/publicar", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);
        await RestAsync(client,token,HttpMethod.Patch,"it_versoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {status="publicada",leitura_ia_status="publicada",revisado_por=userId,revisado_em=DateTimeOffset.UtcNow},"return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao publicar IT.",e.Message),statusCode:500);}
});


app.MapPost("/api/data/query", async (QueryRequest q, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        if (!Regex.IsMatch(q.Table ?? "", "^[a-zA-Z0-9_]+$"))
            return Results.Json(Error("Tabela inválida."), statusCode: 400);

        var query = new List<string>();
        if (!string.IsNullOrWhiteSpace(q.Select))
            query.Add("select=" + Uri.EscapeDataString(q.Select!));
        if (q.Filters is not null)
        {
            foreach (var f in q.Filters)
            {
                if (!Regex.IsMatch(f.Column ?? "", "^[a-zA-Z0-9_.]+$")) continue;
                var expression = f.Type switch
                {
                    "eq" => "eq." + JsonValue(f.Value),
                    "is" => "is." + JsonValue(f.Value),
                    "in" => "in." + InValue(f.Value),
                    _ => null
                };
                if (expression is not null)
                    query.Add(Uri.EscapeDataString(f.Column) + "=" + Uri.EscapeDataString(expression));
            }
        }
        if (q.Order is not null && !string.IsNullOrWhiteSpace(q.Order.Column))
            query.Add("order=" + Uri.EscapeDataString(q.Order.Column + (q.Order.Ascending ? ".asc" : ".desc")));
        if (q.Limit is > 0) query.Add("limit=" + q.Limit.Value);
        if (!string.IsNullOrWhiteSpace(q.OnConflict))
            query.Add("on_conflict=" + Uri.EscapeDataString(q.OnConflict));

        var url = $"{supabaseUrl}/rest/v1/{q.Table}" + (query.Count > 0 ? "?" + string.Join("&", query) : "");
        var op = (q.Operation ?? "select").ToLowerInvariant();
        var method = op switch
        {
            "insert" => HttpMethod.Post,
            "update" => HttpMethod.Patch,
            "upsert" => HttpMethod.Post,
            "delete" => HttpMethod.Delete,
            _ => q.Head == true ? HttpMethod.Head : HttpMethod.Get
        };

        var msg = new HttpRequestMessage(method, url);
        ApplyAuth(msg, token);
        msg.Headers.TryAddWithoutValidation("Accept", "application/json");

        var prefer = new List<string>();
        if (!string.IsNullOrWhiteSpace(q.Count)) prefer.Add("count=" + q.Count);
        if (op is "insert" or "update" or "upsert" or "delete")
            prefer.Add(string.IsNullOrWhiteSpace(q.Select) ? "return=minimal" : "return=representation");
        if (op == "upsert") prefer.Add("resolution=merge-duplicates");
        if (prefer.Count > 0) msg.Headers.TryAddWithoutValidation("Prefer", string.Join(",", prefer));

        if (q.Body is JsonElement body && method != HttpMethod.Get && method != HttpMethod.Head)
            msg.Content = new StringContent(body.GetRawText(), Encoding.UTF8, "application/json");

        var res = await factory.CreateClient("supabase").SendAsync(msg);
        var raw = q.Head == true ? "" : await res.Content.ReadAsStringAsync();

        long? count = null;
        if (res.Content.Headers.TryGetValues("Content-Range", out var ranges))
        {
            var range = ranges.FirstOrDefault();
            var slash = range?.LastIndexOf('/') ?? -1;
            if (slash >= 0 && long.TryParse(range![(slash + 1)..], out var parsed)) count = parsed;
        }

        if (!res.IsSuccessStatusCode)
            return Results.Json(Error("Falha no backend SGQ.", raw), statusCode: (int)res.StatusCode);

        object? data = null;
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try { data = JsonSerializer.Deserialize<JsonElement>(raw); }
            catch { data = raw; }
        }
        return Results.Json(new { data, error = (object?)null, count });
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
    catch (Exception e) { return Results.Json(Error("Erro interno da API.", e.Message), statusCode: 500); }
});

app.MapPost("/api/functions/{name}", async (string name, JsonElement body, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        if (!Regex.IsMatch(name, "^[a-zA-Z0-9_-]+$")) return Results.BadRequest();
        var token = Token(request);
        var msg = new HttpRequestMessage(HttpMethod.Post, $"{supabaseUrl}/functions/v1/{name}");
        ApplyAuth(msg, token);
        msg.Content = new StringContent(body.GetRawText(), Encoding.UTF8, "application/json");
        var res = await factory.CreateClient("supabase").SendAsync(msg);
        var raw = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            return Results.Json(new { data = (object?)null, error = new { message = raw } }, statusCode: (int)res.StatusCode);
        object? data;
        try { data = JsonSerializer.Deserialize<JsonElement>(raw); } catch { data = raw; }
        return Results.Json(new { data, error = (object?)null });
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
});

app.MapPost("/api/storage/{bucket}/signed-url", async (string bucket, SignedUrlRequest body, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        var path = EncodedPath(body.Path);
        var msg = new HttpRequestMessage(HttpMethod.Post, $"{supabaseUrl}/storage/v1/object/sign/{Uri.EscapeDataString(bucket)}/{path}");
        ApplyAuth(msg, token);
        msg.Content = JsonContent.Create(new { expiresIn = body.ExpiresIn });
        var res = await factory.CreateClient("supabase").SendAsync(msg);
        var raw = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) return Results.Json(Error("Falha ao gerar URL assinada.", raw), statusCode: (int)res.StatusCode);
        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        var signed = root.TryGetProperty("signedURL", out var s1) ? s1.GetString()
            : root.TryGetProperty("signedUrl", out var s2) ? s2.GetString() : null;
        if (!string.IsNullOrWhiteSpace(signed) && signed.StartsWith("/")) signed = supabaseUrl + "/storage/v1" + signed;
        return Results.Json(new { data = new { signedUrl = signed }, error = (object?)null });
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
});

app.MapPost("/api/storage/{bucket}/signed-urls", async (string bucket, SignedUrlsRequest body, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        var client = factory.CreateClient("supabase");
        var list = new List<object>();
        foreach (var item in body.Paths)
        {
            var path = EncodedPath(item);
            var msg = new HttpRequestMessage(HttpMethod.Post, $"{supabaseUrl}/storage/v1/object/sign/{Uri.EscapeDataString(bucket)}/{path}");
            ApplyAuth(msg, token);
            msg.Content = JsonContent.Create(new { expiresIn = body.ExpiresIn });
            var res = await client.SendAsync(msg);
            var raw = await res.Content.ReadAsStringAsync();
            string? signed = null;
            if (res.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                signed = root.TryGetProperty("signedURL", out var s1) ? s1.GetString()
                    : root.TryGetProperty("signedUrl", out var s2) ? s2.GetString() : null;
                if (!string.IsNullOrWhiteSpace(signed) && signed.StartsWith("/")) signed = supabaseUrl + "/storage/v1" + signed;
            }
            list.Add(new { path = item, signedUrl = signed, error = res.IsSuccessStatusCode ? null : raw });
        }
        return Results.Json(new { data = list, error = (object?)null });
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
});

app.MapPost("/api/storage/{bucket}/upload", async (string bucket, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        var path = request.Query["path"].ToString();
        var upsert = request.Query["upsert"].ToString().Equals("true", StringComparison.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(path)) return Results.Json(Error("Path obrigatório."), statusCode: 400);
        var form = await request.ReadFormAsync();
        var file = form.Files.FirstOrDefault();
        if (file is null) return Results.Json(Error("Arquivo obrigatório."), statusCode: 400);

        await using var stream = file.OpenReadStream();
        using var content = new StreamContent(stream);
        content.Headers.ContentType = new MediaTypeHeaderValue(string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType);

        var msg = new HttpRequestMessage(HttpMethod.Post, $"{supabaseUrl}/storage/v1/object/{Uri.EscapeDataString(bucket)}/{EncodedPath(path)}");
        ApplyAuth(msg, token);
        msg.Headers.TryAddWithoutValidation("x-upsert", upsert ? "true" : "false");
        msg.Content = content;

        var res = await factory.CreateClient("supabase").SendAsync(msg);
        var raw = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) return Results.Json(Error("Falha ao enviar arquivo.", raw), statusCode: (int)res.StatusCode);
        object? data;
        try { data = JsonSerializer.Deserialize<JsonElement>(raw); } catch { data = raw; }
        return Results.Json(new { data, error = (object?)null });
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
});

app.MapGet("/api/auditorias/generate/{executionId}", async (string executionId, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        var msg = new HttpRequestMessage(HttpMethod.Get, $"{auditDocsUrl}/generate/{Uri.EscapeDataString(executionId)}");
        msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var res = await factory.CreateClient("supabase").SendAsync(msg);
        var bytes = await res.Content.ReadAsByteArrayAsync();
        if (!res.IsSuccessStatusCode)
            return Results.Text(Encoding.UTF8.GetString(bytes), "application/json", statusCode: (int)res.StatusCode);

        var contentType = res.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
        var fileName = res.Headers.TryGetValues("X-SGQ-File-Name", out var values) ? values.FirstOrDefault() : null;
        return Results.File(bytes, contentType, fileName ?? $"auditoria-{executionId}.docx");
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
});

app.Run();

public sealed class ProductLookupRequest
{
    public string Codigo { get; set; } = "";
}
public sealed class RetentionRequest
{
    public string? MotivoSemRetencao { get; set; }
    public List<RetentionItemRequest> Itens { get; set; } = [];
}
public sealed class RetentionItemRequest
{
    public string ProcessoItemId { get; set; } = "";
    public decimal Quantidade { get; set; }
    public string Endereco { get; set; } = "";
    public string FotoCadastroPath { get; set; } = "";
}
public sealed class CreateSampleRequest
{
    public string GroupId { get; set; } = "";
    public string? Descricao { get; set; }
    public string? Lote { get; set; }
    public decimal Quantidade { get; set; }
    public string Endereco { get; set; } = "";
    public string Unidade { get; set; } = "conjunto";
}
public sealed class StockMoveRequest
{
    public string Tipo { get; set; } = "retirada";
    public decimal Quantidade { get; set; }
    public string? Endereco { get; set; }
    public string? Motivo { get; set; }
}
public sealed class RegisterItRequest
{
    public string Codigo { get; set; } = "";
    public string Titulo { get; set; } = "";
    public string Versao { get; set; } = "";
    public DateOnly? Vigencia { get; set; }
    public string ArquivoNome { get; set; } = "";
    public string ArquivoStoragePath { get; set; } = "";
    public string? ArquivoMime { get; set; }
}

public sealed class RegisterUnitRequest
{
    public bool Conforme { get; set; }
    public string? Severidade { get; set; }
    public string? Descricao { get; set; }
    public string? ItemId { get; set; }
    public string? ChecklistId { get; set; }
}
public sealed class ChecklistResultRequest
{
    public string? Resultado { get; set; }
    public string? Severidade { get; set; }
}
public sealed class InternalNoteRequest
{
    public string? Texto { get; set; }
}
public sealed class DimConfigRequest
{
    public bool NaoAplicavel { get; set; }
    public string? Equipamento { get; set; }
    public string? CodigoEquipamento { get; set; }
    public string? Unidade { get; set; }
    public decimal? ValorNominal { get; set; }
    public decimal? DesvioMenos { get; set; }
    public decimal? DesvioMais { get; set; }
    public string? EspecificacaoDesvio { get; set; }
    public string? TipoReferencia { get; set; }
}
public sealed class DimValueRequest
{
    public decimal Valor { get; set; }
    public string? Unidade { get; set; }
}
public sealed class TestResultRequest
{
    public string Resultado { get; set; } = "";
}
public sealed class FinishInspectionRequest
{
    public string Resultado { get; set; } = "";
    public string? Observacoes { get; set; }
}

public sealed class CreateInspectionRequest
{
    public string Codigo { get; set; } = "";
    public string Cliente { get; set; } = "";
    public string? NotaFiscal { get; set; }
    public string? Origem { get; set; }
    public string? Transporte { get; set; }
    public DateOnly? ChegadaCd { get; set; }
    public DateOnly DataInspecao { get; set; }
    public string ItVersionId { get; set; } = "";
    public string InspectionLevel { get; set; } = "I";
    public List<CreateInspectionItem> Itens { get; set; } = [];
}
public sealed class CreateInspectionItem
{
    public string Sku { get; set; } = "";
    public string Nome { get; set; } = "";
    public string? Lote { get; set; }
    public string? Material { get; set; }
    public string? Capacidade { get; set; }
    public decimal Quantidade { get; set; }
    public decimal? QuantidadePorCaixa { get; set; }
    public decimal CaixasRecebidas { get; set; }
    public decimal CaixasInspecionadas { get; set; }
    public decimal UnidadesPorConjunto { get; set; } = 1;
    public string? FotoPrincipalPath { get; set; }
    public List<BoxDistribution>? DistribuicaoCaixas { get; set; }
}
public sealed class BoxDistribution
{
    public decimal Caixas { get; set; }
    public decimal Unidades { get; set; }
}

public sealed class QueryRequest
{
    public string Table { get; set; } = "";
    public string Operation { get; set; } = "select";
    public string? Select { get; set; }
    public List<QueryFilter>? Filters { get; set; }
    public QueryOrder? Order { get; set; }
    public int? Limit { get; set; }
    public bool? Head { get; set; }
    public string? Count { get; set; }
    public string? OnConflict { get; set; }
    public JsonElement? Body { get; set; }
}
public sealed class QueryFilter
{
    public string Type { get; set; } = "";
    public string Column { get; set; } = "";
    public JsonElement Value { get; set; }
}
public sealed class QueryOrder
{
    public string Column { get; set; } = "";
    public bool Ascending { get; set; } = true;
}
public sealed class SignedUrlRequest
{
    public string Path { get; set; } = "";
    public int ExpiresIn { get; set; } = 3600;
}
public sealed class SignedUrlsRequest
{
    public List<string> Paths { get; set; } = [];
    public int ExpiresIn { get; set; } = 3600;
}
