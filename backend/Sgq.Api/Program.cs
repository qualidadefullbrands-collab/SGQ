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

app.MapGet("/api/auditorias/bootstrap", async (HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var executions=RestAsync(client,token,HttpMethod.Get,"auditoria_execucoes","select=*&order=criado_em.desc&limit=30");
        var templates=RestAsync(client,token,HttpMethod.Get,"auditoria_templates","select=rq_code,rq_version,arquivo_nome,storage_path,ativo&order=rq_code.asc");
        await Task.WhenAll(executions,templates);
        return Results.Ok(new {data=new {executions=executions.Result,templates=templates.Result},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao carregar auditorias.",e.Message),statusCode:500);}
});

app.MapPost("/api/auditorias/criar", async (CreateAuditRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        if(string.IsNullOrWhiteSpace(input.RqCode)||string.IsNullOrWhiteSpace(input.RqVersion)||string.IsNullOrWhiteSpace(input.Titulo))
            return Results.Json(Error("RQ, versão e título são obrigatórios."),statusCode:400);

        var date=input.DataAvaliacao ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var created=await RestAsync(client,token,HttpMethod.Post,"auditoria_execucoes","select=*",
            new {
                rq_code=input.RqCode,
                rq_version=input.RqVersion,
                titulo=input.Titulo,
                data_avaliacao=date,
                mes_referencia=input.MesReferencia,
                responsavel_nome=input.ResponsavelNome,
                progresso_total=input.ProgressoTotal,
                progresso_concluido=0,
                resumo=new {origem="chat_mobile"}
            },"return=representation");
        var (execution,found)=FirstRow(created);
        if(!found) throw new InvalidOperationException("Falha ao criar auditoria.");
        var executionId=execution!.Value.GetProperty("id").GetString()!;

        var intro=input.RqCode switch {
            "RQ016B"=>"Pré-avaliação iniciada. Selecione a área e informe o local atual. Registre o que encontrar por mensagem. Neste RQ não é necessário anexar fotos.",
            "RQ014"=>"Inspeção iniciada. Informe o equipamento e o local, por exemplo “EXT-021, corredor 3”. Depois descreva normalmente o que encontrou ou diga que está tudo certo.",
            _ when input.FixedChecklist=>"Avaliação iniciada. Vá registrando o que observar por texto, voz ou foto. Eu organizo os achados e acompanho os itens do modelo.",
            _=>"Inspeção iniciada. Informe o local/endereço atual e registre cada achado por texto, voz ou foto. Eu organizo as evidências no modelo do RQ."
        };
        await RestAsync(client,token,HttpMethod.Post,"auditoria_mensagens","",
            new {execucao_id=executionId,autor="assistente",texto=intro},"return=minimal");

        return Results.Ok(new {data=execution,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao iniciar auditoria.",e.Message),statusCode:500);}
});

app.MapGet("/api/auditorias/{id}/detalhe", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var executionTask=RestAsync(client,token,HttpMethod.Get,"auditoria_execucoes",$"select=*&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var messagesTask=RestAsync(client,token,HttpMethod.Get,"auditoria_mensagens",$"select=*&execucao_id=eq.{Uri.EscapeDataString(id)}&order=criado_em.asc");
        var answersTask=RestAsync(client,token,HttpMethod.Get,"auditoria_respostas",$"select=*&execucao_id=eq.{Uri.EscapeDataString(id)}&order=criado_em.asc");
        var findingsTask=RestAsync(client,token,HttpMethod.Get,"auditoria_achados",$"select=*&execucao_id=eq.{Uri.EscapeDataString(id)}&order=criado_em.asc");
        var objectsTask=RestAsync(client,token,HttpMethod.Get,"auditoria_objetos",$"select=*&execucao_id=eq.{Uri.EscapeDataString(id)}&order=criado_em.asc");
        await Task.WhenAll(executionTask,messagesTask,answersTask,findingsTask,objectsTask);
        var (execution,found)=FirstRow(executionTask.Result);
        if(!found) return Results.Json(Error("Auditoria não encontrada."),statusCode:404);

        var photoUrls=new Dictionary<string,string?>();
        if(messagesTask.Result is {ValueKind:JsonValueKind.Array})
        {
            foreach(var m in messagesTask.Result.Value.EnumerateArray())
            {
                if(!m.TryGetProperty("foto_path",out var fp)||fp.ValueKind!=JsonValueKind.String) continue;
                var path=fp.GetString();
                if(string.IsNullOrWhiteSpace(path)||photoUrls.ContainsKey(path)) continue;
                var sign=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/storage/v1/object/sign/auditoria-evidencias/{EncodedPath(path)}");
                ApplyAuth(sign,token);
                sign.Content=JsonContent.Create(new {expiresIn=3600});
                var res=await client.SendAsync(sign);
                string? url=null;
                if(res.IsSuccessStatusCode)
                {
                    var raw=await res.Content.ReadAsStringAsync();
                    using var doc=JsonDocument.Parse(raw);
                    var root=doc.RootElement;
                    url=root.TryGetProperty("signedURL",out var s1)?s1.GetString():
                        root.TryGetProperty("signedUrl",out var s2)?s2.GetString():null;
                    if(!string.IsNullOrWhiteSpace(url)&&url.StartsWith("/")) url=supabaseUrl+"/storage/v1"+url;
                }
                photoUrls[path]=url;
            }
        }

        return Results.Ok(new {data=new {
            execution,
            messages=messagesTask.Result,
            answers=answersTask.Result,
            findings=findingsTask.Result,
            objects=objectsTask.Result,
            photoUrls
        },error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao abrir auditoria.",e.Message),statusCode:500);}
});

app.MapPut("/api/auditorias/{id}/respostas/{itemKey}", async (string id,string itemKey,AuditAnswerRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        if(input.Resultado is not ("C" or "NC" or "NA"))
            return Results.Json(Error("Resultado inválido."),statusCode:400);

        var saved=await RestAsync(client,token,HttpMethod.Post,"auditoria_respostas",
            "on_conflict=execucao_id,item_key,local_ref&select=*",
            new {
                execucao_id=id,
                item_key=itemKey,
                local_ref=input.LocalRef??"",
                resultado=input.Resultado,
                observacao=input.Observacao??"Registro manual do auditor",
                confianca=input.Confianca??1m,
                atualizado_em=DateTimeOffset.UtcNow
            },"resolution=merge-duplicates,return=representation");
        var (row,found)=FirstRow(saved);
        if(!found) throw new InvalidOperationException("Falha ao salvar resposta.");

        var all=await RestAsync(client,token,HttpMethod.Get,"auditoria_respostas",$"select=item_key&execucao_id=eq.{Uri.EscapeDataString(id)}");
        var done=all is {ValueKind:JsonValueKind.Array}
            ? all.Value.EnumerateArray().Select(x=>x.GetProperty("item_key").GetString()).Where(x=>!string.IsNullOrWhiteSpace(x)).Distinct().Count()
            : 0;
        var executionRows=await RestAsync(client,token,HttpMethod.Get,"auditoria_execucoes",
            $"select=progresso_total,resumo&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (execution,ef)=FirstRow(executionRows);
        var currentTotal=ef&&execution!.Value.TryGetProperty("progresso_total",out var pt)&&pt.ValueKind==JsonValueKind.Number?pt.GetInt32():0;
        var total=input.ProgressoTotalEsperado>0?input.ProgressoTotalEsperado:Math.Max(currentTotal,done);
        await RestAsync(client,token,HttpMethod.Patch,"auditoria_execucoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {progresso_total=total,progresso_concluido=done,atualizado_em=DateTimeOffset.UtcNow},"return=minimal");

        return Results.Ok(new {data=new {resposta=row,progresso_concluido=done,progresso_total=total},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao salvar resposta da auditoria.",e.Message),statusCode:500);}
});

app.MapPost("/api/auditorias/{id}/mensagens", async (string id,AuditMessageRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        if(string.IsNullOrWhiteSpace(input.Message))
            return Results.Json(Error("Mensagem vazia."),statusCode:400);

        var auditorRows=await RestAsync(client,token,HttpMethod.Post,"auditoria_mensagens","select=*",
            new {
                execucao_id=id,
                autor="auditor",
                texto=input.Message.Trim(),
                foto_path=input.PhotoPath,
                foto_mime=input.PhotoMime,
                metadata=new {local=input.CurrentLocation,area=input.Area}
            },"return=representation");
        var (auditorMessage,auditorFound)=FirstRow(auditorRows);
        if(!auditorFound) throw new InvalidOperationException("Falha ao salvar mensagem do auditor.");
        var auditorMessageId=auditorMessage!.Value.GetProperty("id").GetString()!;

        JsonElement interpreted;
        var degraded=false;
        try
        {
            var fn=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/sgq-auditoria-assistente");
            ApplyAuth(fn,token);
            fn.Content=JsonContent.Create(new {
                rqCode=input.RqCode,
                message=input.Message.Trim(),
                imageDataUrl=input.ImageDataUrl,
                criteria=input.Criteria,
                state=input.State
            });
            var res=await client.SendAsync(fn);
            var raw=await res.Content.ReadAsStringAsync();
            if(!res.IsSuccessStatusCode) throw new InvalidOperationException(raw);
            using var doc=JsonDocument.Parse(raw);
            interpreted=doc.RootElement.Clone();
        }
        catch
        {
            degraded=true;
            using var fallback=JsonDocument.Parse("""{"reply":"Registro salvo. A análise assistida não respondeu agora; você pode revisar pelo checklist.","matches":[],"finding":null,"subject":null,"finishRequested":false,"degraded":true}""");
            interpreted=fallback.RootElement.Clone();
        }

        if(interpreted.TryGetProperty("matches",out var matches)&&matches.ValueKind==JsonValueKind.Array)
        {
            foreach(var match in matches.EnumerateArray())
            {
                var key=match.TryGetProperty("key",out var ke)&&ke.ValueKind==JsonValueKind.String?ke.GetString():null;
                var result=match.TryGetProperty("result",out var rs)&&rs.ValueKind==JsonValueKind.String?rs.GetString():null;
                if(string.IsNullOrWhiteSpace(key)||result is not ("C" or "NC" or "NA")) continue;
                var location=match.TryGetProperty("location",out var lo)&&lo.ValueKind==JsonValueKind.String?lo.GetString():
                    ((input.RqCode=="RQ016B"||input.RqCode=="RQ015")?input.CurrentLocation:"");
                var observation=match.TryGetProperty("observation",out var ob)&&ob.ValueKind==JsonValueKind.String?ob.GetString():input.Message.Trim();
                decimal confidence=0m;
                if(match.TryGetProperty("confidence",out var co)&&co.ValueKind==JsonValueKind.Number) confidence=co.GetDecimal();

                await RestAsync(client,token,HttpMethod.Post,"auditoria_respostas",
                    "on_conflict=execucao_id,item_key,local_ref",
                    new {
                        execucao_id=id,item_key=key,local_ref=location??"",resultado=result,
                        observacao=observation,confianca=confidence,origem_mensagem_id=auditorMessageId,
                        atualizado_em=DateTimeOffset.UtcNow
                    },"resolution=merge-duplicates,return=minimal");
            }
        }

        object? savedSubject=null;
        if(input.RqCode=="RQ014" &&
           interpreted.TryGetProperty("subject",out var subject) &&
           subject.ValueKind==JsonValueKind.Object &&
           subject.TryGetProperty("type",out var st) && st.ValueKind==JsonValueKind.String)
        {
            var type=st.GetString();
            var key=subject.TryGetProperty("key",out var sk)&&sk.ValueKind==JsonValueKind.String?sk.GetString():null;
            var identification=subject.TryGetProperty("identification",out var si)&&si.ValueKind==JsonValueKind.String?si.GetString():null;
            var location=subject.TryGetProperty("location",out var sl)&&sl.ValueKind==JsonValueKind.String?sl.GetString():input.CurrentLocation;
            var objectKey=(key??identification??location??input.CurrentLocation??"").Trim();
            if(!string.IsNullOrWhiteSpace(type)&&!string.IsNullOrWhiteSpace(objectKey))
            {
                JsonElement? data=subject.TryGetProperty("data",out var sd)?sd.Clone():null;
                JsonElement? criteriaNc=subject.TryGetProperty("criteria_nc",out var sc)?sc.Clone():null;
                var status=subject.TryGetProperty("status",out var ss)&&ss.ValueKind==JsonValueKind.String?ss.GetString():null;
                var objRows=await RestAsync(client,token,HttpMethod.Post,"auditoria_objetos",
                    "on_conflict=execucao_id,objeto_tipo,chave&select=*",
                    new {
                        execucao_id=id,objeto_tipo=type,chave=objectKey,identificacao=identification,
                        local_ref=location,dados=data,criterios_nc=criteriaNc,status,
                        observacao=input.Message.Trim(),origem_mensagem_id=auditorMessageId,atualizado_em=DateTimeOffset.UtcNow
                    },"resolution=merge-duplicates,return=representation");
                var (obj,of)=FirstRow(objRows);
                if(of) savedSubject=obj;
            }
        }

        object? savedFinding=null;
        if(interpreted.TryGetProperty("finding",out var finding)&&finding.ValueKind==JsonValueKind.Object)
        {
            var hasDescription=finding.TryGetProperty("description",out var fd)&&fd.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(fd.GetString());
            var hasCriteria=finding.TryGetProperty("criteria",out var fc)&&fc.ValueKind==JsonValueKind.Array&&fc.GetArrayLength()>0;
            if(hasDescription||hasCriteria)
            {
                var address=finding.TryGetProperty("address",out var fa)&&fa.ValueKind==JsonValueKind.String?fa.GetString():null;
                var location=finding.TryGetProperty("location",out var fl)&&fl.ValueKind==JsonValueKind.String?fl.GetString():input.CurrentLocation;
                var description=hasDescription?fd.GetString():input.Message.Trim();
                var risk=finding.TryGetProperty("riskSuggestion",out var fr)&&fr.ValueKind==JsonValueKind.String?fr.GetString():null;
                var action=finding.TryGetProperty("immediateAction",out var fi)&&fi.ValueKind==JsonValueKind.String?fi.GetString():null;
                JsonElement? criteria=hasCriteria?fc.Clone():null;

                var findingRows=await RestAsync(client,token,HttpMethod.Post,"auditoria_achados","select=*",
                    new {
                        execucao_id=id,endereco=address,local_ref=location,criterios=criteria,
                        descricao_original=input.Message.Trim(),descricao_tecnica=description,risco=risk,
                        acao_imediata=action,status="pendente",foto_path=input.PhotoPath,
                        origem_mensagem_id=auditorMessageId,
                        metadata=new {ia=true,risco_sugerido_pela_ia=!string.IsNullOrWhiteSpace(risk)}
                    },"return=representation");
                var (foundFinding,ff)=FirstRow(findingRows);
                if(ff) savedFinding=foundFinding;
            }
        }

        var reply=interpreted.TryGetProperty("reply",out var rp)&&rp.ValueKind==JsonValueKind.String?rp.GetString():"Registro interpretado.";
        var finishRequested=interpreted.TryGetProperty("finishRequested",out var fq)&&fq.ValueKind==JsonValueKind.True;
        var assistantRows=await RestAsync(client,token,HttpMethod.Post,"auditoria_mensagens","select=*",
            new {
                execucao_id=id,autor="assistente",texto=reply,
                metadata=new {
                    matches=interpreted.TryGetProperty("matches",out var im)?im:(JsonElement?)null,
                    finding=interpreted.TryGetProperty("finding",out var iff)?iff:(JsonElement?)null,
                    subject=interpreted.TryGetProperty("subject",out var isu)?isu:(JsonElement?)null,
                    clarification=interpreted.TryGetProperty("clarification",out var ic)?ic:(JsonElement?)null,
                    degraded=degraded||(interpreted.TryGetProperty("degraded",out var dg)&&dg.ValueKind==JsonValueKind.True)
                }
            },"return=representation");
        var (assistantMessage,assistantFound)=FirstRow(assistantRows);

        var answers=await RestAsync(client,token,HttpMethod.Get,"auditoria_respostas",$"select=item_key&execucao_id=eq.{Uri.EscapeDataString(id)}");
        var findings=await RestAsync(client,token,HttpMethod.Get,"auditoria_achados",$"select=id&execucao_id=eq.{Uri.EscapeDataString(id)}");
        var objects=await RestAsync(client,token,HttpMethod.Get,"auditoria_objetos",$"select=id&execucao_id=eq.{Uri.EscapeDataString(id)}");
        var done=answers is {ValueKind:JsonValueKind.Array}
            ? answers.Value.EnumerateArray().Select(x=>x.GetProperty("item_key").GetString()).Where(x=>!string.IsNullOrWhiteSpace(x)).Distinct().Count()
            : 0;
        int Count(JsonElement? x)=>x is {ValueKind:JsonValueKind.Array}?x.Value.GetArrayLength():0;
        var executionRows=await RestAsync(client,token,HttpMethod.Get,"auditoria_execucoes",$"select=progresso_total&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (execution,ef)=FirstRow(executionRows);
        var oldTotal=ef&&execution!.Value.TryGetProperty("progresso_total",out var ot)&&ot.ValueKind==JsonValueKind.Number?ot.GetInt32():0;
        var total=input.FixedChecklist&&input.CriteriaCount>0?input.CriteriaCount:Math.Max(oldTotal,done);
        await RestAsync(client,token,HttpMethod.Patch,"auditoria_execucoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {
                progresso_total=total,progresso_concluido=done,atualizado_em=DateTimeOffset.UtcNow,
                resumo=new {
                    respostas=answers is {ValueKind:JsonValueKind.Array}?answers.Value.GetArrayLength():0,
                    achados=Count(findings),objetos=Count(objects),ultima_localizacao=input.CurrentLocation
                }
            },"return=minimal");

        return Results.Ok(new {data=new {
            auditorMessage,
            assistantMessage=assistantFound?assistantMessage:(object?)null,
            finding=savedFinding,
            subject=savedSubject,
            finishRequested,
            degraded
        },error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao processar mensagem da auditoria.",e.Message),statusCode:500);}
});

app.MapPost("/api/auditorias/{id}/concluir", async (string id,FinishAuditRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var answers=await RestAsync(client,token,HttpMethod.Get,"auditoria_respostas",$"select=id&execucao_id=eq.{Uri.EscapeDataString(id)}");
        var findings=await RestAsync(client,token,HttpMethod.Get,"auditoria_achados",$"select=id&execucao_id=eq.{Uri.EscapeDataString(id)}");
        var objects=await RestAsync(client,token,HttpMethod.Get,"auditoria_objetos",$"select=id&execucao_id=eq.{Uri.EscapeDataString(id)}");
        int Count(JsonElement? v)=>v is {ValueKind:JsonValueKind.Array}?v.Value.GetArrayLength():0;
        var now=DateTimeOffset.UtcNow;
        var updated=await RestAsync(client,token,HttpMethod.Patch,"auditoria_execucoes",
            $"id=eq.{Uri.EscapeDataString(id)}&select=*",
            new {
                status="concluida",
                finalizado_em=now,
                atualizado_em=now,
                power_automate_status="aguardando_geracao_documento",
                resumo=new {
                    respostas=Count(answers),
                    achados=Count(findings),
                    objetos=Count(objects),
                    observacao_integracao="Word oficial será gerado antes do POST HTTP ao Power Automate."
                }
            },"return=representation");
        var (row,found)=FirstRow(updated);
        if(!found) throw new InvalidOperationException("Falha ao concluir auditoria.");
        return Results.Ok(new {data=row,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao concluir auditoria.",e.Message),statusCode:500);}
});

app.MapGet("/api/app/bootstrap", async (HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);

        var profileTask=RestAsync(client,token,HttpMethod.Get,"profiles",$"select=nome,perfil&id=eq.{Uri.EscapeDataString(userId)}&limit=1");
        var processesTask=RestAsync(client,token,HttpMethod.Get,"processos",
            "select=id,codigo,cliente,nota_fiscal,origem,transporte,chegada_cd,data_processo,status,criado_em&excluido_em=is.null&order=criado_em.desc");
        var inspectionsTask=RestAsync(client,token,HttpMethod.Get,"inspecoes",
            "select=id,numero,status,resultado,tamanho_lote,tamanho_amostra,total_inspecionado,total_nao_conforme,nivel_inspecao,codigo_amostragem,criado_em,grupos_inspecao(id,nome,tipo,processo_id,processos(id,codigo,cliente,nota_fiscal,origem,transporte,chegada_cd,data_processo,status,criado_em)),it_versoes(id,versao,instrucoes_trabalho(codigo,titulo))&excluido_em=is.null&order=criado_em.desc");
        var itsTask=RestAsync(client,token,HttpMethod.Get,"it_versoes",
            "select=id,versao,status,vigencia,nivel_inspecao_padrao,leitura_ia_status,arquivo_nome,instrucoes_trabalho(codigo,titulo)&order=criado_em.desc");
        var groupsTask=RestAsync(client,token,HttpMethod.Get,"grupos_inspecao",
            "select=id,nome,codigo,tipo,tamanho_lote_estatistico,processo_id,processos(codigo,cliente)&order=criado_em.desc");
        var samplesTask=RestAsync(client,token,HttpMethod.Get,"vw_saldo_amostras",
            "select=id,codigo,descricao,endereco,lote,saldo,unidade_controle,qr_token,grupo_inspecao_id,inspecao_id,produto_id,sku,processo_referencia,data_chegada_referencia,nota_fiscal_referencia,cliente_referencia,observacao,origem_importacao,linha_origem,laudo_id,laudo_numero,laudo_storage_path,foto_cadastro_path,produto_foto_principal_path,data_inspecao_referencia&order=codigo.desc");
        var reportsTask=RestAsync(client,token,HttpMethod.Get,"laudos","select=id");

        await Task.WhenAll(profileTask,processesTask,inspectionsTask,itsTask,groupsTask,samplesTask,reportsTask);
        var (profile,profileFound)=FirstRow(profileTask.Result);
        if(!profileFound) return Results.Json(Error("Seu usuário ainda não possui perfil liberado no SGQ."),statusCode:403);

        int Count(JsonElement? value)=>value is {ValueKind:JsonValueKind.Array}?value.Value.GetArrayLength():0;
        return Results.Ok(new {
            data=new {
                profile,
                processes=processesTask.Result,
                inspections=inspectionsTask.Result,
                itVersions=itsTask.Result,
                groups=groupsTask.Result,
                samples=samplesTask.Result,
                counts=new {
                    processos=Count(processesTask.Result),
                    inspecoes=Count(inspectionsTask.Result),
                    amostras=Count(samplesTask.Result),
                    laudos=Count(reportsTask.Result)
                }
            },
            error=(object?)null
        });
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao carregar o SGQ.",e.Message),statusCode:500);}
});

app.MapGet("/api/inspecoes/{id}/detalhe", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var insRows=await RestAsync(client,token,HttpMethod.Get,"inspecoes",
            $"select=*,grupos_inspecao(*,processos(*)),it_versoes(*,instrucoes_trabalho(*))&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (ins,found)=FirstRow(insRows);
        if(!found) return Results.Json(Error("Inspeção não encontrada."),statusCode:404);
        var i=ins!.Value;
        var groupId=i.GetProperty("grupo_inspecao_id").GetString()!;
        var itId=i.GetProperty("it_versao_id").GetString()!;

        var itemsTask=RestAsync(client,token,HttpMethod.Get,"grupo_inspecao_itens",
            $"select=id,papel,quantidade_componente,unidades_por_conjunto,processo_itens(id,produto_id,lote,quantidade,material,capacidade,quantidade_por_caixa,caixas_recebidas,caixas_inspecionadas,distribuicao_caixas,produtos(id,sku,nome,foto_principal_path))&grupo_inspecao_id=eq.{Uri.EscapeDataString(groupId)}");
        var checklistTask=RestAsync(client,token,HttpMethod.Get,"it_checklist",$"select=*&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true&order=ordem.asc");
        var checkResultsTask=RestAsync(client,token,HttpMethod.Get,"inspecao_checklist_resultados",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var paramsTask=RestAsync(client,token,HttpMethod.Get,"it_parametros_dimensionais",$"select=*&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true&order=ordem.asc");
        var dimResultsTask=RestAsync(client,token,HttpMethod.Get,"inspecao_dimensionais",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var dimConfigsTask=RestAsync(client,token,HttpMethod.Get,"inspecao_dimensional_configuracoes",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var testsTask=RestAsync(client,token,HttpMethod.Get,"it_testes_especiais",$"select=*&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true&order=ordem.asc");
        var testResultsTask=RestAsync(client,token,HttpMethod.Get,"inspecao_testes_resultados",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var photosTask=RestAsync(client,token,HttpMethod.Get,"inspecao_fotos",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}&order=criado_em.asc");
        var registersTask=RestAsync(client,token,HttpMethod.Get,"inspecao_registros",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}&order=sequencia.asc");
        var ncsTask=RestAsync(client,token,HttpMethod.Get,"inspecao_nao_conformidades",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}&order=criado_em.asc");
        var retainedTask=RestAsync(client,token,HttpMethod.Get,"amostras",$"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}");

        await Task.WhenAll(itemsTask,checklistTask,checkResultsTask,paramsTask,dimResultsTask,dimConfigsTask,testsTask,testResultsTask,photosTask,registersTask,ncsTask,retainedTask);

        var photoUrls=new Dictionary<string,string?>();
        if(photosTask.Result is {ValueKind:JsonValueKind.Array})
        {
            foreach(var photo in photosTask.Result.Value.EnumerateArray())
            {
                if(!photo.TryGetProperty("storage_path",out var sp)||sp.ValueKind!=JsonValueKind.String) continue;
                var path=sp.GetString();
                if(string.IsNullOrWhiteSpace(path)) continue;
                var sign=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/storage/v1/object/sign/inspecao-fotos/{EncodedPath(path)}");
                ApplyAuth(sign,token);
                sign.Content=JsonContent.Create(new {expiresIn=3600});
                var res=await client.SendAsync(sign);
                string? url=null;
                if(res.IsSuccessStatusCode)
                {
                    var raw=await res.Content.ReadAsStringAsync();
                    using var doc=JsonDocument.Parse(raw);
                    var root=doc.RootElement;
                    url=root.TryGetProperty("signedURL",out var s1)?s1.GetString():
                        root.TryGetProperty("signedUrl",out var s2)?s2.GetString():null;
                    if(!string.IsNullOrWhiteSpace(url)&&url.StartsWith("/")) url=supabaseUrl+"/storage/v1"+url;
                }
                photoUrls[path]=url;
            }
        }

        return Results.Ok(new {
            data=new {
                inspecao=i,
                items=itemsTask.Result,
                checklist=checklistTask.Result,
                checklistResults=checkResultsTask.Result,
                @params=paramsTask.Result,
                dimResults=dimResultsTask.Result,
                dimConfigs=dimConfigsTask.Result,
                tests=testsTask.Result,
                testResults=testResultsTask.Result,
                photos=photosTask.Result,
                photoUrls,
                registers=registersTask.Result,
                ncs=ncsTask.Result,
                retained=retainedTask.Result
            },
            error=(object?)null
        });
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao carregar inspeção.",e.Message),statusCode:500);}
});

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

app.MapPut("/api/processos/{id}", async (string id,ProcessUpdateRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        await RestAsync(factory.CreateClient("supabase"),token,HttpMethod.Patch,"processos",
            $"id=eq.{Uri.EscapeDataString(id)}",
            new {
                cliente=input.Cliente,
                nota_fiscal=input.NotaFiscal,
                origem=input.Origem,
                transporte=input.Transporte,
                chegada_cd=input.ChegadaCd,
                atualizado_em=DateTimeOffset.UtcNow
            },"return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao atualizar processo.",e.Message),statusCode:500);}
});

app.MapPost("/api/processos/{id}/excluir", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);
        await RestAsync(client,token,HttpMethod.Patch,"processos",$"id=eq.{Uri.EscapeDataString(id)}",
            new {excluido_em=DateTimeOffset.UtcNow,excluido_por=userId,status="cancelado"},"return=minimal");
        await RestAsync(client,token,HttpMethod.Post,"audit_log","",
            new {usuario_id=userId,entidade="processos",entidade_id=id,acao="exclusao_logica",dados=new {}},"return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao excluir processo.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/excluir", async (string id,DeleteInspectionRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);
        await RestAsync(client,token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {excluido_em=DateTimeOffset.UtcNow,excluido_por=userId,status="cancelada"},"return=minimal");
        await RestAsync(client,token,HttpMethod.Post,"audit_log","",
            new {usuario_id=userId,entidade="inspecoes",entidade_id=id,acao="exclusao_logica",dados=new {numero=input.Numero}},"return=minimal");
        return Results.Ok(new {data=new {ok=true},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao excluir inspeção.",e.Message),statusCode:500);}
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

app.MapPost("/api/inspecoes/{id}/assistente", async (string id,AssistantRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var fn=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/sgq-assistente");
        ApplyAuth(fn,token);
        fn.Content=JsonContent.Create(new {mode=input.Mode,question=input.Question??"",context=input.Context});
        var res=await client.SendAsync(fn);
        var raw=await res.Content.ReadAsStringAsync();
        if(!res.IsSuccessStatusCode)
            return Results.Ok(new {data=(object?)null,error=new {message="A IA assistida não respondeu.",details=raw}});
        object? data;
        try{data=JsonSerializer.Deserialize<JsonElement>(raw);}catch{data=new {text=raw};}
        return Results.Ok(new {data,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao consultar a IA assistida.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/conclusao-assistida", async (string id,AssistantConclusionRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var fn=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/sgq-conclusao");
        ApplyAuth(fn,token);
        fn.Content=new StringContent(input.Payload.GetRawText(),Encoding.UTF8,"application/json");
        var res=await client.SendAsync(fn);
        var raw=await res.Content.ReadAsStringAsync();
        object? data;
        try{data=JsonSerializer.Deserialize<JsonElement>(raw);}catch{data=new {text=raw};}
        if(!res.IsSuccessStatusCode)
            return Results.Ok(new {data,error=new {message="Não foi possível gerar a conclusão com IA.",details=raw}});
        return Results.Ok(new {data,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao gerar conclusão assistida.",e.Message),statusCode:500);}
});

app.MapPost("/api/its/{id}/estruturar", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var fn=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/estruturar-it");
        ApplyAuth(fn,token);
        fn.Content=JsonContent.Create(new {it_versao_id=id});
        var res=await client.SendAsync(fn);
        var raw=await res.Content.ReadAsStringAsync();
        object? data;
        try{data=JsonSerializer.Deserialize<JsonElement>(raw);}catch{data=new {message=raw};}
        if(!res.IsSuccessStatusCode)
            return Results.Ok(new {data=(object?)null,error=new {message="Não foi possível estruturar a IT.",details=raw}});
        return Results.Ok(new {data,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao estruturar IT.",e.Message),statusCode:500);}
});

app.MapGet("/api/its/{id}/revisao", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var checks=RestAsync(client,token,HttpMethod.Get,"it_checklist",$"select=*&it_versao_id=eq.{Uri.EscapeDataString(id)}&ativo=eq.true&order=ordem.asc");
        var dims=RestAsync(client,token,HttpMethod.Get,"it_parametros_dimensionais",$"select=*&it_versao_id=eq.{Uri.EscapeDataString(id)}&ativo=eq.true&order=ordem.asc");
        var tests=RestAsync(client,token,HttpMethod.Get,"it_testes_especiais",$"select=*&it_versao_id=eq.{Uri.EscapeDataString(id)}&ativo=eq.true&order=ordem.asc");
        var version=RestAsync(client,token,HttpMethod.Get,"it_versoes",$"select=extracao_ia&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        await Task.WhenAll(checks,dims,tests,version);
        var (versionRow,_)=FirstRow(version.Result);
        JsonElement? extraction=versionRow.HasValue&&versionRow.Value.TryGetProperty("extracao_ia",out var ex)?ex.Clone():null;
        return Results.Ok(new {data=new {
            checklist=checks.Result,dimensionais=dims.Result,testes=tests.Result,extracao_ia=extraction
        },error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao carregar revisão da IT.",e.Message),statusCode:500);}
});

app.MapGet("/api/inspecoes/{id}/chat", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var rows=await RestAsync(client,token,HttpMethod.Get,"inspecao_chat_mensagens",
            $"select=*&inspecao_id=eq.{Uri.EscapeDataString(id)}&order=criado_em.asc");
        if(rows is {ValueKind:JsonValueKind.Array} && rows.Value.GetArrayLength()>0)
            return Results.Ok(new {data=rows,error=(object?)null});

        var intro="Modo chat iniciado. Você pode registrar unidades, verificações, testes e medições em linguagem natural. Fotos ficam para a etapa final da inspeção.";
        var created=await RestAsync(client,token,HttpMethod.Post,"inspecao_chat_mensagens","select=*",
            new {inspecao_id=id,autor="assistente",texto=intro,metadata=new {tipo="intro"}},"return=representation");
        return Results.Ok(new {data=created,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao carregar o chat.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/chat", async (string id,InspectionChatRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var userId=await CurrentUserId(client,token);
        if(string.IsNullOrWhiteSpace(input.Message))
            return Results.Json(Error("Mensagem vazia."),statusCode:400);

        var inspectorRows=await RestAsync(client,token,HttpMethod.Post,"inspecao_chat_mensagens","select=*",
            new {inspecao_id=id,autor="inspetor",texto=input.Message.Trim(),metadata=new {}},"return=representation");
        var (inspectorMessage,imf)=FirstRow(inspectorRows);
        if(!imf) throw new InvalidOperationException("Falha ao salvar mensagem do inspetor.");

        JsonElement parsed;
        var degraded=false;
        try
        {
            var fn=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/sgq-inspecao-chat");
            ApplyAuth(fn,token);
            fn.Content=JsonContent.Create(new {message=input.Message.Trim(),context=input.Context});
            var res=await client.SendAsync(fn);
            var raw=await res.Content.ReadAsStringAsync();
            if(!res.IsSuccessStatusCode) throw new InvalidOperationException(raw);
            using var doc=JsonDocument.Parse(raw);
            parsed=doc.RootElement.Clone();
        }
        catch
        {
            degraded=true;
            using var fallback=JsonDocument.Parse("""{"reply":"Mensagem registrada. A IA não respondeu agora; os dados podem ser preenchidos pelo modo tradicional.","finishRequested":false,"checklistUpdates":[],"sampleResults":[],"testUpdates":[],"dimensionMeasurements":[],"degraded":true}""");
            parsed=fallback.RootElement.Clone();
        }

        var insRows=await RestAsync(client,token,HttpMethod.Get,"inspecoes",
            $"select=it_versao_id,grupo_inspecao_id,tamanho_amostra&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (inspection,insFound)=FirstRow(insRows);
        if(!insFound) return Results.Json(Error("Inspeção não encontrada."),statusCode:404);
        var itId=inspection!.Value.GetProperty("it_versao_id").GetString()!;
        var groupId=inspection.Value.GetProperty("grupo_inspecao_id").GetString()!;
        var sampleLimit=inspection.Value.TryGetProperty("tamanho_amostra",out var ss)&&ss.ValueKind==JsonValueKind.Number?ss.GetInt32():0;

        var checkRows=await RestAsync(client,token,HttpMethod.Get,"it_checklist",$"select=id&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true");
        var validChecks=new HashSet<string>(
            checkRows is {ValueKind:JsonValueKind.Array}
                ? checkRows.Value.EnumerateArray().Select(x=>x.GetProperty("id").GetString()!).Where(x=>!string.IsNullOrWhiteSpace(x))
                : [],
            StringComparer.OrdinalIgnoreCase);

        var linkRows=await RestAsync(client,token,HttpMethod.Get,"grupo_inspecao_itens",$"select=processo_item_id&grupo_inspecao_id=eq.{Uri.EscapeDataString(groupId)}");
        var validItems=new HashSet<string>(
            linkRows is {ValueKind:JsonValueKind.Array}
                ? linkRows.Value.EnumerateArray().Select(x=>x.GetProperty("processo_item_id").GetString()!).Where(x=>!string.IsNullOrWhiteSpace(x))
                : [],
            StringComparer.OrdinalIgnoreCase);

        if(parsed.TryGetProperty("checklistUpdates",out var checklistUpdates)&&checklistUpdates.ValueKind==JsonValueKind.Array)
        {
            foreach(var item in checklistUpdates.EnumerateArray())
            {
                var checkId=item.TryGetProperty("checklistId",out var ci)&&ci.ValueKind==JsonValueKind.String?ci.GetString():null;
                var result=item.TryGetProperty("result",out var rs)&&rs.ValueKind==JsonValueKind.String?rs.GetString():null;
                if(string.IsNullOrWhiteSpace(checkId)||!validChecks.Contains(checkId)||string.IsNullOrWhiteSpace(result)) continue;
                var severity=item.TryGetProperty("severity",out var se)&&se.ValueKind==JsonValueKind.String?se.GetString():null;
                var observation=item.TryGetProperty("observation",out var ob)&&ob.ValueKind==JsonValueKind.String?ob.GetString():null;
                await RestAsync(client,token,HttpMethod.Post,"inspecao_checklist_resultados",
                    "on_conflict=inspecao_id,checklist_id",
                    new {
                        inspecao_id=id,checklist_id=checkId,resultado=result,observacao=observation,
                        severidade_confirmada=result=="nao_conforme"?(string.IsNullOrWhiteSpace(severity)?"grave":severity):null,
                        registrado_por=userId,registrado_em=DateTimeOffset.UtcNow
                    },"resolution=merge-duplicates,return=minimal");
            }
        }

        if(parsed.TryGetProperty("sampleResults",out var sampleResults)&&sampleResults.ValueKind==JsonValueKind.Array)
        {
            var currentRows=await RestAsync(client,token,HttpMethod.Get,"inspecao_registros",$"select=sequencia,conforme&inspecao_id=eq.{Uri.EscapeDataString(id)}&order=sequencia.asc");
            var seq=0;
            if(currentRows is {ValueKind:JsonValueKind.Array})
                foreach(var row in currentRows.Value.EnumerateArray())
                    if(row.TryGetProperty("sequencia",out var sq)&&sq.ValueKind==JsonValueKind.Number) seq=Math.Max(seq,sq.GetInt32());

            foreach(var item in sampleResults.EnumerateArray())
            {
                if(sampleLimit>0 && seq>=sampleLimit) break;
                var conforme=item.TryGetProperty("conforme",out var cf)&&cf.ValueKind==JsonValueKind.True;
                string? checkId=item.TryGetProperty("checklistId",out var ci)&&ci.ValueKind==JsonValueKind.String?ci.GetString():null;
                string? description=item.TryGetProperty("description",out var ds)&&ds.ValueKind==JsonValueKind.String?ds.GetString():null;
                if(!conforme && (string.IsNullOrWhiteSpace(checkId)||!validChecks.Contains(checkId)||string.IsNullOrWhiteSpace(description))) continue;
                seq++;

                var regRows=await RestAsync(client,token,HttpMethod.Post,"inspecao_registros","select=id",
                    new {inspecao_id=id,sequencia=seq,conforme,observacao=conforme?"Registrado pelo modo chat":description},"return=representation");
                var (reg,rf)=FirstRow(regRows);
                if(!rf) continue;

                if(!conforme)
                {
                    var processItemId=item.TryGetProperty("processoItemId",out var pi)&&pi.ValueKind==JsonValueKind.String?pi.GetString():null;
                    if(!string.IsNullOrWhiteSpace(processItemId)&&!validItems.Contains(processItemId)) processItemId=null;
                    var severity=item.TryGetProperty("severity",out var sv)&&sv.ValueKind==JsonValueKind.String?sv.GetString():"grave";
                    var ncSeverity=severity=="critico"?"critica":severity=="toleravel"?"leve":"maior";
                    await RestAsync(client,token,HttpMethod.Post,"inspecao_nao_conformidades","",
                        new {
                            inspecao_id=id,inspecao_registro_id=reg!.Value.GetProperty("id").GetString(),
                            processo_item_id=processItemId,checklist_id=checkId,descricao=description,
                            severidade=ncSeverity,tipo="amostragem_chat"
                        },"return=minimal");
                    await RestAsync(client,token,HttpMethod.Post,"inspecao_checklist_resultados",
                        "on_conflict=inspecao_id,checklist_id",
                        new {
                            inspecao_id=id,checklist_id=checkId,resultado="nao_conforme",
                            severidade_confirmada=severity,observacao=description,
                            registrado_por=userId,registrado_em=DateTimeOffset.UtcNow
                        },"resolution=merge-duplicates,return=minimal");
                }
            }

            var all=await RestAsync(client,token,HttpMethod.Get,"inspecao_registros",$"select=conforme&inspecao_id=eq.{Uri.EscapeDataString(id)}");
            var total=all is {ValueKind:JsonValueKind.Array}?all.Value.GetArrayLength():0;
            var nc=all is {ValueKind:JsonValueKind.Array}?all.Value.EnumerateArray().Count(x=>x.TryGetProperty("conforme",out var cf)&&cf.ValueKind==JsonValueKind.False):0;
            await RestAsync(client,token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
                new {total_inspecionado=total,total_conforme=total-nc,total_nao_conforme=nc},"return=minimal");
        }

        if(parsed.TryGetProperty("testUpdates",out var testUpdates)&&testUpdates.ValueKind==JsonValueKind.Array)
        {
            var tests=await RestAsync(client,token,HttpMethod.Get,"it_testes_especiais",$"select=id&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true");
            var validTests=new HashSet<string>(
                tests is {ValueKind:JsonValueKind.Array}?tests.Value.EnumerateArray().Select(x=>x.GetProperty("id").GetString()!).Where(x=>!string.IsNullOrWhiteSpace(x)):[],
                StringComparer.OrdinalIgnoreCase);
            foreach(var item in testUpdates.EnumerateArray())
            {
                var testId=item.TryGetProperty("testId",out var ti)&&ti.ValueKind==JsonValueKind.String?ti.GetString():null;
                var result=item.TryGetProperty("result",out var tr)&&tr.ValueKind==JsonValueKind.String?tr.GetString():null;
                if(string.IsNullOrWhiteSpace(testId)||!validTests.Contains(testId)||string.IsNullOrWhiteSpace(result)) continue;
                await RestAsync(client,token,HttpMethod.Post,"inspecao_testes_resultados","on_conflict=inspecao_id,teste_id",
                    new {inspecao_id=id,teste_id=testId,resultado=result,registrado_por=userId,registrado_em=DateTimeOffset.UtcNow},
                    "resolution=merge-duplicates,return=minimal");
            }
        }

        if(parsed.TryGetProperty("dimensionMeasurements",out var measurements)&&measurements.ValueKind==JsonValueKind.Array)
        {
            var paramRows=await RestAsync(client,token,HttpMethod.Get,"it_parametros_dimensionais",$"select=id,unidade&it_versao_id=eq.{Uri.EscapeDataString(itId)}&ativo=eq.true");
            var validParams=new Dictionary<string,string?>(StringComparer.OrdinalIgnoreCase);
            if(paramRows is {ValueKind:JsonValueKind.Array})
                foreach(var p in paramRows.Value.EnumerateArray())
                {
                    var pid=p.GetProperty("id").GetString();
                    if(!string.IsNullOrWhiteSpace(pid)) validParams[pid]=p.TryGetProperty("unidade",out var un)&&un.ValueKind==JsonValueKind.String?un.GetString():null;
                }

            foreach(var item in measurements.EnumerateArray())
            {
                var paramId=item.TryGetProperty("parametroId",out var pm)&&pm.ValueKind==JsonValueKind.String?pm.GetString():null;
                var processItemId=item.TryGetProperty("processoItemId",out var pi)&&pi.ValueKind==JsonValueKind.String?pi.GetString():null;
                if(string.IsNullOrWhiteSpace(paramId)||!validParams.ContainsKey(paramId)||string.IsNullOrWhiteSpace(processItemId)||!validItems.Contains(processItemId)) continue;
                if(!item.TryGetProperty("value",out var vl)||vl.ValueKind!=JsonValueKind.Number) continue;
                var value=vl.GetDecimal();

                var cfgRows=await RestAsync(client,token,HttpMethod.Get,"inspecao_dimensional_configuracoes",
                    $"select=nao_aplicavel,unidade,minimo_aceitavel,maximo_aceitavel&inspecao_id=eq.{Uri.EscapeDataString(id)}&processo_item_id=eq.{Uri.EscapeDataString(processItemId)}&parametro_id=eq.{Uri.EscapeDataString(paramId)}&limit=1");
                var (cfg,cfgFound)=FirstRow(cfgRows);
                if(cfgFound&&cfg!.Value.TryGetProperty("nao_aplicavel",out var na)&&na.ValueKind==JsonValueKind.True) continue;

                var current=await RestAsync(client,token,HttpMethod.Get,"inspecao_dimensionais",
                    $"select=sequencia_amostra&inspecao_id=eq.{Uri.EscapeDataString(id)}&processo_item_id=eq.{Uri.EscapeDataString(processItemId)}&parametro_id=eq.{Uri.EscapeDataString(paramId)}");
                var used=new HashSet<int>();
                if(current is {ValueKind:JsonValueKind.Array})
                    foreach(var r in current.Value.EnumerateArray())
                        if(r.TryGetProperty("sequencia_amostra",out var sq)&&sq.ValueKind==JsonValueKind.Number) used.Add(sq.GetInt32());
                var seq=Enumerable.Range(1,10).FirstOrDefault(x=>!used.Contains(x));
                if(seq==0) continue;

                decimal? min=null,max=null;
                string? unit=validParams[paramId];
                if(cfgFound)
                {
                    if(cfg!.Value.TryGetProperty("minimo_aceitavel",out var mn)&&mn.ValueKind==JsonValueKind.Number) min=mn.GetDecimal();
                    if(cfg.Value.TryGetProperty("maximo_aceitavel",out var mx)&&mx.ValueKind==JsonValueKind.Number) max=mx.GetDecimal();
                    if(cfg.Value.TryGetProperty("unidade",out var un)&&un.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(un.GetString())) unit=un.GetString();
                }
                if(item.TryGetProperty("unit",out var iu)&&iu.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(iu.GetString())) unit=iu.GetString();
                bool? conforme=min is null&&max is null?null:(min is null||value>=min)&&(max is null||value<=max);
                await RestAsync(client,token,HttpMethod.Post,"inspecao_dimensionais",
                    "on_conflict=inspecao_id,processo_item_id,parametro_id,sequencia_amostra",
                    new {inspecao_id=id,processo_item_id=processItemId,parametro_id=paramId,sequencia_amostra=seq,valor=value,unidade=unit,conforme},
                    "resolution=merge-duplicates,return=minimal");
            }
        }

        var reply=parsed.TryGetProperty("reply",out var rp)&&rp.ValueKind==JsonValueKind.String?rp.GetString():"Registro interpretado.";
        var finishRequested=parsed.TryGetProperty("finishRequested",out var fr)&&fr.ValueKind==JsonValueKind.True;
        var assistantRows=await RestAsync(client,token,HttpMethod.Post,"inspecao_chat_mensagens","select=*",
            new {
                inspecao_id=id,autor="assistente",texto=reply,
                metadata=new {
                    checklistUpdates=parsed.TryGetProperty("checklistUpdates",out var cu)?cu:(JsonElement?)null,
                    sampleResults=parsed.TryGetProperty("sampleResults",out var sr)?sr:(JsonElement?)null,
                    testUpdates=parsed.TryGetProperty("testUpdates",out var tu)?tu:(JsonElement?)null,
                    dimensionMeasurements=parsed.TryGetProperty("dimensionMeasurements",out var dm)?dm:(JsonElement?)null,
                    finishRequested,
                    degraded=degraded||(parsed.TryGetProperty("degraded",out var dg)&&dg.ValueKind==JsonValueKind.True)
                }
            },"return=representation");
        var (assistantMessage,amf)=FirstRow(assistantRows);

        return Results.Ok(new {data=new {
            inspectorMessage,
            assistantMessage=amf?assistantMessage:(object?)null,
            finishRequested,
            degraded
        },error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao processar mensagem da inspeção.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/fotos/registrar", async (string id,RegisterInspectionPhotosRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var saved=0;
        foreach(var photo in input.Fotos ?? [])
        {
            if(string.IsNullOrWhiteSpace(photo.StoragePath)||string.IsNullOrWhiteSpace(photo.Legenda)) continue;
            await RestAsync(client,token,HttpMethod.Post,"inspecao_fotos","",
                new {inspecao_id=id,storage_path=photo.StoragePath,legenda=photo.Legenda.Trim()},"return=minimal");
            if(!string.IsNullOrWhiteSpace(photo.ProductId)&&!string.IsNullOrWhiteSpace(photo.ProductPhotoPath))
            {
                await RestAsync(client,token,HttpMethod.Patch,"produtos",
                    $"id=eq.{Uri.EscapeDataString(photo.ProductId)}",
                    new {foto_principal_path=photo.ProductPhotoPath,atualizado_em=DateTimeOffset.UtcNow},"return=minimal");
            }
            saved++;
        }
        return Results.Ok(new {data=new {salvas=saved},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao registrar fotos da inspeção.",e.Message),statusCode:500);}
});

app.MapPost("/api/inspecoes/{id}/laudo", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");

        var insRows=await RestAsync(client,token,HttpMethod.Get,"inspecoes",
            $"select=numero,resultado,observacoes,data_inspecao,tamanho_lote,nivel_inspecao,codigo_amostragem,tamanho_amostra,total_inspecionado,total_nao_conforme,grupo_inspecao_id,it_versao_id&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (ins,found)=FirstRow(insRows);
        if(!found) return Results.Json(Error("Inspeção não encontrada."),statusCode:404);
        var i=ins!.Value;
        var numero=i.GetProperty("numero").GetString() ?? id;
        var groupId=i.GetProperty("grupo_inspecao_id").GetString()!;
        var itVersionId=i.GetProperty("it_versao_id").GetString()!;

        var groupRows=await RestAsync(client,token,HttpMethod.Get,"grupos_inspecao",
            $"select=processo_id&id=eq.{Uri.EscapeDataString(groupId)}&limit=1");
        var (group,gf)=FirstRow(groupRows);
        if(!gf) throw new InvalidOperationException("Grupo não encontrado.");
        var processId=group!.Value.GetProperty("processo_id").GetString()!;

        var processRows=await RestAsync(client,token,HttpMethod.Get,"processos",
            $"select=codigo,cliente,nota_fiscal,origem,transporte&id=eq.{Uri.EscapeDataString(processId)}&limit=1");
        var (process,pf)=FirstRow(processRows);
        if(!pf) throw new InvalidOperationException("Processo não encontrado.");

        var versionRows=await RestAsync(client,token,HttpMethod.Get,"it_versoes",
            $"select=versao,instrucao_trabalho_id&id=eq.{Uri.EscapeDataString(itVersionId)}&limit=1");
        var (version,vf)=FirstRow(versionRows);
        if(!vf) throw new InvalidOperationException("Versão da IT não encontrada.");
        var instructionId=version!.Value.GetProperty("instrucao_trabalho_id").GetString()!;
        var instructionRows=await RestAsync(client,token,HttpMethod.Get,"instrucoes_trabalho",
            $"select=codigo,titulo&id=eq.{Uri.EscapeDataString(instructionId)}&limit=1");
        var (instruction,inf)=FirstRow(instructionRows);

        var itemLinks=await RestAsync(client,token,HttpMethod.Get,"grupo_inspecao_itens",
            $"select=processo_item_id&grupo_inspecao_id=eq.{Uri.EscapeDataString(groupId)}");
        var productsHtml=new StringBuilder();
        if(itemLinks is {ValueKind:JsonValueKind.Array})
        {
            foreach(var link in itemLinks.Value.EnumerateArray())
            {
                var itemId=link.GetProperty("processo_item_id").GetString()!;
                var itemRows=await RestAsync(client,token,HttpMethod.Get,"processo_itens",
                    $"select=produto_id,lote,quantidade&id=eq.{Uri.EscapeDataString(itemId)}&limit=1");
                var (item,itemFound)=FirstRow(itemRows);
                if(!itemFound) continue;
                var productId=item!.Value.GetProperty("produto_id").GetString()!;
                var productRows=await RestAsync(client,token,HttpMethod.Get,"produtos",
                    $"select=sku,nome&id=eq.{Uri.EscapeDataString(productId)}&limit=1");
                var (product,productFound)=FirstRow(productRows);
                if(!productFound) continue;
                string Enc(JsonElement el,string name)
                    => el.TryGetProperty(name,out var v)&&v.ValueKind!=JsonValueKind.Null
                        ? System.Net.WebUtility.HtmlEncode(v.ToString()) : "";
                productsHtml.Append("<tr><td>").Append(Enc(product!.Value,"sku")).Append("</td><td>")
                    .Append(Enc(product.Value,"nome")).Append("</td><td>")
                    .Append(Enc(item.Value,"lote")).Append("</td><td>")
                    .Append(Enc(item.Value,"quantidade")).Append("</td></tr>");
            }
        }

        var checks=await RestAsync(client,token,HttpMethod.Get,"it_checklist",
            $"select=id,ordem,requisito&it_versao_id=eq.{Uri.EscapeDataString(itVersionId)}&ativo=eq.true&order=ordem.asc");
        var checkResults=await RestAsync(client,token,HttpMethod.Get,"inspecao_checklist_resultados",
            $"select=checklist_id,resultado,severidade_confirmada&inspecao_id=eq.{Uri.EscapeDataString(id)}");
        var resultMap=new Dictionary<string,(string? Resultado,string? Severidade)>();
        if(checkResults is {ValueKind:JsonValueKind.Array})
        {
            foreach(var r in checkResults.Value.EnumerateArray())
            {
                var cid=r.GetProperty("checklist_id").GetString();
                if(string.IsNullOrWhiteSpace(cid)) continue;
                resultMap[cid]=(r.TryGetProperty("resultado",out var rv)?rv.GetString():null,
                    r.TryGetProperty("severidade_confirmada",out var sv)&&sv.ValueKind==JsonValueKind.String?sv.GetString():null);
            }
        }
        var checksHtml=new StringBuilder();
        if(checks is {ValueKind:JsonValueKind.Array})
        {
            foreach(var check in checks.Value.EnumerateArray())
            {
                var cid=check.GetProperty("id").GetString()!;
                resultMap.TryGetValue(cid,out var rr);
                var order=check.TryGetProperty("ordem",out var or)?or.ToString():"";
                var req=check.TryGetProperty("requisito",out var rq)?rq.GetString():"";
                checksHtml.Append("<tr><td>").Append(System.Net.WebUtility.HtmlEncode(order)).Append("</td><td>")
                    .Append(System.Net.WebUtility.HtmlEncode(req)).Append("</td><td>")
                    .Append(System.Net.WebUtility.HtmlEncode(rr.Resultado??"pendente")).Append("</td><td>")
                    .Append(System.Net.WebUtility.HtmlEncode(rr.Severidade??"")).Append("</td></tr>");
            }
        }

        string Str(JsonElement el,string name)
            => el.TryGetProperty(name,out var v)&&v.ValueKind!=JsonValueKind.Null?v.ToString():"";
        var p=process!.Value;
        var instructionCode=inf?Str(instruction!.Value,"codigo"):"";
        var instructionTitle=inf?Str(instruction!.Value,"titulo"):"";
        var itVersion=Str(version.Value,"versao");
        var html=$@"<html><head><meta charset=""utf-8""><style>
body{{font-family:Calibri,Arial,sans-serif;font-size:10.5pt}}h1{{font-size:17pt}}h2{{font-size:12pt;margin-top:18px}}
table{{border-collapse:collapse;width:100%;margin:8px 0}}td,th{{border:1px solid #777;padding:5px}}th{{background:#eee;text-align:left}}
</style></head><body>
<h1>REGISTRO DE INSPEÇÃO</h1>
<p><b>{System.Net.WebUtility.HtmlEncode(instructionCode)}</b> · {System.Net.WebUtility.HtmlEncode(instructionTitle)} · versão {System.Net.WebUtility.HtmlEncode(itVersion)}</p>
<h2>Identificação</h2>
<table><tr><th>Processo FST</th><td>{System.Net.WebUtility.HtmlEncode(Str(p,"codigo"))}</td><th>Cliente</th><td>{System.Net.WebUtility.HtmlEncode(Str(p,"cliente"))}</td></tr>
<tr><th>Nota fiscal</th><td>{System.Net.WebUtility.HtmlEncode(Str(p,"nota_fiscal"))}</td><th>Data</th><td>{System.Net.WebUtility.HtmlEncode(Str(i,"data_inspecao"))}</td></tr>
<tr><th>Origem</th><td>{System.Net.WebUtility.HtmlEncode(Str(p,"origem"))}</td><th>Transporte</th><td>{System.Net.WebUtility.HtmlEncode(Str(p,"transporte"))}</td></tr></table>
<h2>Produtos / componentes</h2><table><tr><th>Código</th><th>Descrição</th><th>Lote</th><th>Quantidade</th></tr>{productsHtml}</table>
<h2>Plano de amostragem</h2><table>
<tr><th>Lote estatístico</th><td>{System.Net.WebUtility.HtmlEncode(Str(i,"tamanho_lote"))}</td><th>Nível</th><td>{System.Net.WebUtility.HtmlEncode(Str(i,"nivel_inspecao"))}</td></tr>
<tr><th>Código</th><td>{System.Net.WebUtility.HtmlEncode(Str(i,"codigo_amostragem"))}</td><th>Amostra prevista</th><td>{System.Net.WebUtility.HtmlEncode(Str(i,"tamanho_amostra"))}</td></tr>
<tr><th>Amostra efetiva</th><td>{System.Net.WebUtility.HtmlEncode(Str(i,"total_inspecionado"))}</td><th>Não conformes</th><td>{System.Net.WebUtility.HtmlEncode(Str(i,"total_nao_conforme"))}</td></tr></table>
<h2>Verificações</h2><table><tr><th>Nº</th><th>Análise</th><th>Resultado</th><th>Classe</th></tr>{checksHtml}</table>
<h2>Resultado final</h2><p><b>{System.Net.WebUtility.HtmlEncode(Str(i,"resultado").ToUpperInvariant())}</b></p>
<p>{System.Net.WebUtility.HtmlEncode(Str(i,"observacoes"))}</p>
</body></html>";
        var bytes=Encoding.UTF8.GetBytes(html);
        var storagePath=$"{id}/{numero}.doc";
        var upload=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/storage/v1/object/laudos/{EncodedPath(storagePath)}");
        ApplyAuth(upload,token);
        upload.Headers.TryAddWithoutValidation("x-upsert","true");
        upload.Content=new ByteArrayContent(bytes);
        upload.Content.Headers.ContentType=new MediaTypeHeaderValue("application/msword");
        var uploadRes=await client.SendAsync(upload);
        var uploadRaw=await uploadRes.Content.ReadAsStringAsync();
        if(!uploadRes.IsSuccessStatusCode) throw new InvalidOperationException("Falha ao armazenar laudo: "+uploadRaw);

        var reportRows=await RestAsync(client,token,HttpMethod.Get,"laudos",
            $"select=id&inspecao_id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (report,reportFound)=FirstRow(reportRows);
        string reportId;
        if(reportFound) reportId=report!.Value.GetProperty("id").GetString()!;
        else
        {
            var newReport=await RestAsync(client,token,HttpMethod.Post,"laudos","select=id",
                new {inspecao_id=id,numero},"return=representation");
            var (nr,nf)=FirstRow(newReport);
            if(!nf) throw new InvalidOperationException("Falha ao criar registro do laudo.");
            reportId=nr!.Value.GetProperty("id").GetString()!;
        }
        var generatedAt=DateTimeOffset.UtcNow;
        await RestAsync(client,token,HttpMethod.Patch,"laudos",$"id=eq.{Uri.EscapeDataString(reportId)}",
            new {storage_path=storagePath,gerado_em=generatedAt},"return=minimal");
        await RestAsync(client,token,HttpMethod.Patch,"amostras",
            $"inspecao_id=eq.{Uri.EscapeDataString(id)}&laudo_id=is.null",new {laudo_id=reportId},"return=minimal");
        await RestAsync(client,token,HttpMethod.Patch,"inspecoes",$"id=eq.{Uri.EscapeDataString(id)}",
            new {documento_gerado_em=generatedAt},"return=minimal");

        var sign=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/storage/v1/object/sign/laudos/{EncodedPath(storagePath)}");
        ApplyAuth(sign,token);
        sign.Content=JsonContent.Create(new {expiresIn=600});
        var signRes=await client.SendAsync(sign);
        var signRaw=await signRes.Content.ReadAsStringAsync();
        string? signedUrl=null;
        if(signRes.IsSuccessStatusCode)
        {
            using var sd=JsonDocument.Parse(signRaw);
            var root=sd.RootElement;
            signedUrl=root.TryGetProperty("signedURL",out var s1)?s1.GetString():
                root.TryGetProperty("signedUrl",out var s2)?s2.GetString():null;
            if(!string.IsNullOrWhiteSpace(signedUrl)&&signedUrl.StartsWith("/")) signedUrl=supabaseUrl+"/storage/v1"+signedUrl;
        }

        return Results.Ok(new {data=new {url=signedUrl,filename=$"{Str(p,"codigo")}-{numero}.doc",storage_path=storagePath,laudo_id=reportId},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao gerar laudo.",e.Message),statusCode:500);}
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

app.MapGet("/api/amostras/{id}/detalhe", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var rows=await RestAsync(client,token,HttpMethod.Get,"vw_saldo_amostras",
            $"select=id,foto_cadastro_path,produto_foto_principal_path,laudo_id,laudo_numero,laudo_storage_path&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (sample,found)=FirstRow(rows);
        if(!found) return Results.Json(Error("Amostra não encontrada."),statusCode:404);

        async Task<string?> Sign(string bucket,string? path)
        {
            if(string.IsNullOrWhiteSpace(path)) return null;
            var msg=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/storage/v1/object/sign/{Uri.EscapeDataString(bucket)}/{EncodedPath(path)}");
            ApplyAuth(msg,token);
            msg.Content=JsonContent.Create(new {expiresIn=3600});
            var res=await client.SendAsync(msg);
            if(!res.IsSuccessStatusCode) return null;
            var raw=await res.Content.ReadAsStringAsync();
            using var doc=JsonDocument.Parse(raw);
            var root=doc.RootElement;
            var url=root.TryGetProperty("signedURL",out var s1)?s1.GetString():
                root.TryGetProperty("signedUrl",out var s2)?s2.GetString():null;
            if(!string.IsNullOrWhiteSpace(url)&&url.StartsWith("/")) url=supabaseUrl+"/storage/v1"+url;
            return url;
        }

        string? Value(string name)=>sample!.Value.TryGetProperty(name,out var v)&&v.ValueKind==JsonValueKind.String?v.GetString():null;
        var cadastro=await Sign("amostra-cadastro",Value("foto_cadastro_path"));
        var principal=await Sign("produto-fotos",Value("produto_foto_principal_path"));
        var report=await Sign("laudos",Value("laudo_storage_path"));
        return Results.Ok(new {data=new {
            fotoCadastroUrl=cadastro,
            produtoFotoPrincipalUrl=principal,
            laudo=string.IsNullOrWhiteSpace(Value("laudo_id"))?null:new {numero=Value("laudo_numero"),url=report}
        },error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao carregar amostra.",e.Message),statusCode:500);}
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

app.MapPut("/api/auditorias/templates/{rqCode}", async (string rqCode,AuditTemplateRequest input,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        if(string.IsNullOrWhiteSpace(input.StoragePath)||string.IsNullOrWhiteSpace(input.ArquivoNome)||string.IsNullOrWhiteSpace(input.RqVersion))
            return Results.Json(Error("Arquivo, caminho e versão do modelo são obrigatórios."),statusCode:400);
        var updated=await RestAsync(factory.CreateClient("supabase"),token,HttpMethod.Patch,"auditoria_templates",
            $"rq_code=eq.{Uri.EscapeDataString(rqCode)}&select=*",
            new {
                storage_path=input.StoragePath,
                arquivo_nome=input.ArquivoNome,
                rq_version=input.RqVersion,
                ativo=true,
                atualizado_em=DateTimeOffset.UtcNow
            },"return=representation");
        var (row,found)=FirstRow(updated);
        if(!found) throw new InvalidOperationException("Modelo de auditoria não encontrado.");
        return Results.Ok(new {data=row,error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao atualizar modelo oficial.",e.Message),statusCode:500);}
});

app.MapGet("/api/auditorias/{id}/documento", async (string id,HttpRequest request,IHttpClientFactory factory)=>
{
    try
    {
        var token=Token(request);
        var client=factory.CreateClient("supabase");
        var rows=await RestAsync(client,token,HttpMethod.Get,"auditoria_execucoes",
            $"select=documento_storage_path,documento_nome&id=eq.{Uri.EscapeDataString(id)}&limit=1");
        var (execution,found)=FirstRow(rows);
        if(!found) return Results.Json(Error("Auditoria não encontrada."),statusCode:404);
        var path=execution!.Value.TryGetProperty("documento_storage_path",out var dp)&&dp.ValueKind==JsonValueKind.String?dp.GetString():null;
        var name=execution.Value.TryGetProperty("documento_nome",out var dn)&&dn.ValueKind==JsonValueKind.String?dn.GetString():null;
        if(string.IsNullOrWhiteSpace(path)) return Results.Ok(new {data=(object?)null,error=(object?)null});

        var sign=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/storage/v1/object/sign/auditoria-relatorios/{EncodedPath(path)}");
        ApplyAuth(sign,token);
        sign.Content=JsonContent.Create(new {expiresIn=300});
        var res=await client.SendAsync(sign);
        var raw=await res.Content.ReadAsStringAsync();
        if(!res.IsSuccessStatusCode) return Results.Json(Error("Falha ao abrir Word armazenado.",raw),statusCode:(int)res.StatusCode);
        using var doc=JsonDocument.Parse(raw);
        var root=doc.RootElement;
        var url=root.TryGetProperty("signedURL",out var s1)?s1.GetString():
            root.TryGetProperty("signedUrl",out var s2)?s2.GetString():null;
        if(!string.IsNullOrWhiteSpace(url)&&url.StartsWith("/")) url=supabaseUrl+"/storage/v1"+url;
        return Results.Ok(new {data=new {url,filename=name,path},error=(object?)null});
    }
    catch(UnauthorizedAccessException e){return Results.Json(Error(e.Message),statusCode:401);}
    catch(Exception e){return Results.Json(Error("Falha ao obter documento da auditoria.",e.Message),statusCode:500);}
});

app.MapGet("/api/auditorias/generate/{executionId}", async (string executionId, HttpRequest request, IHttpClientFactory factory) =>
{
    try
    {
        var token = Token(request);
        var client=factory.CreateClient("supabase");
        var msg = new HttpRequestMessage(HttpMethod.Get, $"{auditDocsUrl}/generate/{Uri.EscapeDataString(executionId)}");
        msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var res = await client.SendAsync(msg);
        var bytes = await res.Content.ReadAsByteArrayAsync();
        if (!res.IsSuccessStatusCode)
            return Results.Text(Encoding.UTF8.GetString(bytes), "application/json", statusCode: (int)res.StatusCode);

        var integrationStatus="not_configured";
        try
        {
            var integration=new HttpRequestMessage(HttpMethod.Post,$"{supabaseUrl}/functions/v1/sgq-auditoria-integracao");
            ApplyAuth(integration,token);
            integration.Content=JsonContent.Create(new {executionId});
            var intRes=await client.SendAsync(integration);
            var raw=await intRes.Content.ReadAsStringAsync();
            if(intRes.IsSuccessStatusCode)
            {
                using var doc=JsonDocument.Parse(raw);
                var root=doc.RootElement;
                var configured=root.TryGetProperty("configured",out var cf)&&cf.ValueKind==JsonValueKind.True;
                var sent=root.TryGetProperty("sent",out var se)&&se.ValueKind==JsonValueKind.True;
                integrationStatus=sent?"sent":configured?"configured":"not_configured";
            }
            else integrationStatus="error";
        }
        catch { integrationStatus="error"; }

        var contentType = res.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
        var fileName = res.Headers.TryGetValues("X-SGQ-File-Name", out var values) ? values.FirstOrDefault() : null;
        request.HttpContext.Response.Headers["X-SGQ-Integration-Status"]=integrationStatus;
        return Results.File(bytes, contentType, fileName ?? $"auditoria-{executionId}.docx");
    }
    catch (UnauthorizedAccessException e) { return Results.Json(Error(e.Message), statusCode: 401); }
});

app.Run();

public sealed class CreateAuditRequest
{
    public string RqCode { get; set; } = "";
    public string RqVersion { get; set; } = "";
    public string Titulo { get; set; } = "";
    public DateOnly? DataAvaliacao { get; set; }
    public string? MesReferencia { get; set; }
    public string? ResponsavelNome { get; set; }
    public int ProgressoTotal { get; set; }
    public bool FixedChecklist { get; set; }
}
public sealed class AuditAnswerRequest
{
    public string Resultado { get; set; } = "";
    public string? LocalRef { get; set; }
    public string? Observacao { get; set; }
    public decimal? Confianca { get; set; }
    public int ProgressoTotalEsperado { get; set; }
}
public sealed class AuditMessageRequest
{
    public string RqCode { get; set; } = "";
    public string Message { get; set; } = "";
    public string? ImageDataUrl { get; set; }
    public JsonElement? Criteria { get; set; }
    public JsonElement? State { get; set; }
    public string? CurrentLocation { get; set; }
    public string? Area { get; set; }
    public string? PhotoPath { get; set; }
    public string? PhotoMime { get; set; }
    public bool FixedChecklist { get; set; }
    public int CriteriaCount { get; set; }
}

public sealed class AuditTemplateRequest
{
    public string RqVersion { get; set; } = "";
    public string ArquivoNome { get; set; } = "";
    public string StoragePath { get; set; } = "";
}

public sealed class FinishAuditRequest
{
    public string? Observacao { get; set; }
}

public sealed class ProcessUpdateRequest
{
    public string? Cliente { get; set; }
    public string? NotaFiscal { get; set; }
    public string? Origem { get; set; }
    public string? Transporte { get; set; }
    public DateOnly? ChegadaCd { get; set; }
}
public sealed class DeleteInspectionRequest
{
    public string? Numero { get; set; }
}

public sealed class ProductLookupRequest
{
    public string Codigo { get; set; } = "";
}
public sealed class AssistantRequest
{
    public string Mode { get; set; } = "analisar";
    public string? Question { get; set; }
    public JsonElement? Context { get; set; }
}
public sealed class AssistantConclusionRequest
{
    public JsonElement Payload { get; set; }
}

public sealed class InspectionChatRequest
{
    public string Message { get; set; } = "";
    public JsonElement? Context { get; set; }
}

public sealed class RegisterInspectionPhotosRequest
{
    public List<RegisterInspectionPhotoItem> Fotos { get; set; } = [];
}
public sealed class RegisterInspectionPhotoItem
{
    public string StoragePath { get; set; } = "";
    public string Legenda { get; set; } = "";
    public string? ProductId { get; set; }
    public string? ProductPhotoPath { get; set; }
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
