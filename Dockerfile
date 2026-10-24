# One image: the Vue app is built, then ASP.NET serves it as static files.
# Entra settings are not build arguments. The same image reads them from
# the environment at startup and exposes them at /config.json.

FROM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json Directory.Build.props ./
COPY backend/GymBro.Api/ backend/GymBro.Api/
RUN dotnet publish backend/GymBro.Api/GymBro.Api.csproj -c Release -o /app/publish /p:UseAppHost=false
COPY --from=web /src/frontend/dist /app/publish/wwwroot

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
# A new named volume copies this directory's ownership. Create it as root
# and hand it to the non-root app user before switching USER, or the app
# cannot write Data Protection keys on first start.
RUN mkdir -p /var/lib/gymbro/keys && chown -R "$APP_UID" /var/lib/gymbro
USER $APP_UID
# Default for `docker run` without Compose. Compose replaces this when
# BIND_PORT is set, and publishes that port on BIND_ADDRESS on the host.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://0.0.0.0:8100
EXPOSE 8100
ENTRYPOINT ["dotnet", "GymBro.Api.dll"]
