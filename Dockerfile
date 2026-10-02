FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/Sgq.Api/Sgq.Api.csproj backend/Sgq.Api/
RUN dotnet restore backend/Sgq.Api/Sgq.Api.csproj
COPY backend/Sgq.Api backend/Sgq.Api
RUN dotnet publish backend/Sgq.Api/Sgq.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://0.0.0.0:10000
EXPOSE 10000
ENTRYPOINT ["dotnet","Sgq.Api.dll"]
