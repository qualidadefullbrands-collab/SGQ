FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/Sgq.Api/Sgq.Api.csproj backend/Sgq.Api/
RUN dotnet restore backend/Sgq.Api/Sgq.Api.csproj
COPY backend/Sgq.Api backend/Sgq.Api
RUN dotnet publish backend/Sgq.Api/Sgq.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /tmp/sgq-docs-requirements.txt
RUN python3 -m venv /opt/sgq-docs \
    && /opt/sgq-docs/bin/pip install --no-cache-dir -r /tmp/sgq-docs-requirements.txt

COPY --from=build /app/publish .
COPY server /app/server
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV ASPNETCORE_URLS=http://0.0.0.0:10000
ENV AUDIT_DOCS_URL=http://127.0.0.1:10001
EXPOSE 10000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
