#!/usr/bin/with-contenv bashio

doSupervisorRequest() {
    local url=$1
    local method=${2:-"GET"}
    local data=${3:-""}
    local clean_url="${url#/}"
    local bearer=$(printenv SUPERVISOR_TOKEN)
    response=$(curl -s -X "${method}" -H "X-Supervisor-Token: $bearer" -H "Authorization: Bearer $bearer" -d "${data}" "http://supervisor/${clean_url}")
}

doHaInternalApiRequest() {
    local url=$1
    local method=${2:-"GET"}
    local data=${3:-""}
    local clean_url="${url#/}"
    local bearer=$(printenv SUPERVISOR_TOKEN)
    response=$(curl -s -X "${method}" -H "Authorization: Bearer $bearer" -d "${data}" "http://supervisor/core/api/${clean_url}")
}