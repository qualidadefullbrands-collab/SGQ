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
