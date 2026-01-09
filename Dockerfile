FROM n8nio/n8n:latest

USER root

# Patch the license check to enable all enterprise features
# But handle API_DISABLED specially - it should return false to enable the API
RUN sed -i 's/isLicensed(feature) {/isLicensed(feature) { if (feature === "feat:apiDisabled") return false; return true; \/\/ PATCHED/g' /usr/local/lib/node_modules/n8n/dist/license.js

# Set environment variables
ENV N8N_LICENSE_ENABLED="false"
ENV N8N_DIAGNOSTICS_ENABLED="false"
ENV N8N_VERSION_NOTIFICATIONS_ENABLED="false"
ENV N8N_TEMPLATES_ENABLED="true"

USER node
