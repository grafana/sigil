{{/* Expand the name of the chart. */}}
{{- define "sigil.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Create a default fully qualified app name. */}}
{{- define "sigil.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Create chart name and version as used by the chart label. */}}
{{- define "sigil.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels */}}
{{- define "sigil.labels" -}}
helm.sh/chart: {{ include "sigil.chart" . }}
{{ include "sigil.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels */}}
{{- define "sigil.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sigil.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* API selector labels */}}
{{- define "sigil.apiSelectorLabels" -}}
{{ include "sigil.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end -}}

{{/* Ingester selector labels */}}
{{- define "sigil.ingesterSelectorLabels" -}}
{{ include "sigil.selectorLabels" . }}
app.kubernetes.io/component: ingester
{{- end -}}

{{/* Querier selector labels */}}
{{- define "sigil.querierSelectorLabels" -}}
{{ include "sigil.selectorLabels" . }}
app.kubernetes.io/component: querier
{{- end -}}

{{/* Compactor selector labels */}}
{{- define "sigil.compactorSelectorLabels" -}}
{{ include "sigil.selectorLabels" . }}
app.kubernetes.io/component: compactor
{{- end -}}

{{/* Eval worker selector labels */}}
{{- define "sigil.evalWorkerSelectorLabels" -}}
{{ include "sigil.selectorLabels" . }}
app.kubernetes.io/component: eval-worker
{{- end -}}

{{/* Catalog sync selector labels */}}
{{- define "sigil.catalogSyncSelectorLabels" -}}
{{ include "sigil.selectorLabels" . }}
app.kubernetes.io/component: catalog-sync
{{- end -}}

{{/* Service account name */}}
{{- define "sigil.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "sigil.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Optional component names */}}
{{- define "sigil.mysql.fullname" -}}
{{- printf "%s-mysql" (include "sigil.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sigil.tempo.fullname" -}}
{{- printf "%s-tempo" (include "sigil.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sigil.alloy.fullname" -}}
{{- printf "%s-alloy" (include "sigil.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sigil.prometheus.fullname" -}}
{{- printf "%s-prometheus" (include "sigil.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sigil.minio.fullname" -}}
{{- printf "%s-minio" (include "sigil.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sigil.mysql.authSecretName" -}}
{{- if .Values.mysql.auth.existingSecret -}}
{{- .Values.mysql.auth.existingSecret -}}
{{- else -}}
{{- printf "%s-mysql-auth" (include "sigil.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "sigil.minio.secretName" -}}
{{- if .Values.minio.existingSecret -}}
{{- .Values.minio.existingSecret -}}
{{- else -}}
{{- printf "%s-minio-auth" (include "sigil.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Computed Sigil endpoints */}}
{{- define "sigil.validateStorageBackend" -}}
{{- if ne (lower (toString .Values.sigil.storage.backend)) "mysql" -}}
{{- fail (printf "sigil.storage.backend must be mysql, got %q" .Values.sigil.storage.backend) -}}
{{- end -}}
{{- end -}}

{{- define "sigil.mysql.dsn" -}}
{{- if .Values.sigil.storage.mysql.dsn -}}
{{- .Values.sigil.storage.mysql.dsn -}}
{{- else if .Values.mysql.enabled -}}
{{- printf "%s:%s@tcp(%s:%v)/%s?parseTime=true" .Values.mysql.auth.user .Values.mysql.auth.password (include "sigil.mysql.fullname" .) .Values.mysql.service.port .Values.mysql.auth.database -}}
{{- else -}}
{{- fail "sigil.storage.mysql.dsn must be set when mysql.enabled=false" -}}
{{- end -}}
{{- end -}}

{{- define "sigil.alloy.tempoEndpoint" -}}
{{- if .Values.alloy.outputs.tempo.endpoint -}}
{{- .Values.alloy.outputs.tempo.endpoint -}}
{{- else if .Values.tempo.enabled -}}
{{- printf "%s:%v" (include "sigil.tempo.fullname" .) .Values.tempo.service.ports.grpc -}}
{{- else -}}
tempo:4317
{{- end -}}
{{- end -}}

{{- define "sigil.alloy.prometheusEndpoint" -}}
{{- if .Values.alloy.outputs.prometheus.endpoint -}}
{{- .Values.alloy.outputs.prometheus.endpoint -}}
{{- else if .Values.prometheus.enabled -}}
{{- printf "http://%s:%v/api/v1/otlp" (include "sigil.prometheus.fullname" .) .Values.prometheus.service.port -}}
{{- else -}}
http://prometheus:9090/api/v1/otlp
{{- end -}}
{{- end -}}

{{- define "sigil.objectStore.s3Endpoint" -}}
{{- if .Values.sigil.objectStore.s3.endpoint -}}
{{- .Values.sigil.objectStore.s3.endpoint -}}
{{- else if .Values.minio.enabled -}}
{{- printf "http://%s:%v" (include "sigil.minio.fullname" .) .Values.minio.service.apiPort -}}
{{- else -}}
http://minio:9000
{{- end -}}
{{- end -}}

{{/*
Common Sigil env var mapping.
Inputs:
  - root: chart root context
  - target: SIGIL_TARGET value
  - extraEnv: optional role-specific env list
*/}}
{{- define "sigil.commonEnv" -}}
{{- $root := .root -}}
{{- $target := .target -}}
{{- $httpPort := $root.Values.service.ports.http -}}
{{- if .httpPort -}}
{{- $httpPort = .httpPort -}}
{{- end -}}
{{- $otlpGrpcPort := $root.Values.service.ports.otlpGrpc -}}
{{- if .otlpGrpcPort -}}
{{- $otlpGrpcPort = .otlpGrpcPort -}}
{{- end -}}
- name: SIGIL_HTTP_ADDR
  value: ":{{ $httpPort }}"
- name: SIGIL_OTLP_GRPC_ADDR
  value: ":{{ $otlpGrpcPort }}"
- name: SIGIL_TARGET
  value: {{ $target | quote }}
- name: SIGIL_AUTH_ENABLED
  value: {{ ternary "true" "false" $root.Values.sigil.auth.enabled | quote }}
- name: SIGIL_FAKE_TENANT_ID
  value: {{ $root.Values.sigil.auth.fakeTenantID | quote }}
- name: SIGIL_QUERY_PROXY_PROMETHEUS_BASE_URL
  value: {{ $root.Values.sigil.queryProxy.prometheusBaseURL | quote }}
- name: SIGIL_QUERY_PROXY_TEMPO_BASE_URL
  value: {{ $root.Values.sigil.queryProxy.tempoBaseURL | quote }}
- name: SIGIL_QUERY_PROXY_TIMEOUT
  value: {{ $root.Values.sigil.queryProxy.timeout | quote }}
- name: SIGIL_STORAGE_BACKEND
  value: {{ $root.Values.sigil.storage.backend | quote }}
- name: SIGIL_MYSQL_DSN
  value: {{ include "sigil.mysql.dsn" $root | quote }}
- name: SIGIL_OBJECT_STORE_BACKEND
  value: {{ $root.Values.sigil.objectStore.backend | lower | quote }}
- name: SIGIL_OBJECT_STORE_BUCKET
  value: {{ $root.Values.sigil.objectStore.bucket | quote }}
- name: SIGIL_OBJECT_STORE_ENDPOINT
  value: {{ include "sigil.objectStore.s3Endpoint" $root | quote }}
- name: SIGIL_OBJECT_STORE_S3_REGION
  value: {{ $root.Values.sigil.objectStore.s3.region | quote }}
- name: SIGIL_OBJECT_STORE_INSECURE
  value: {{ ternary "true" "false" $root.Values.sigil.objectStore.s3.insecure | quote }}
- name: SIGIL_OBJECT_STORE_S3_AWS_SDK_AUTH
  value: {{ ternary "true" "false" $root.Values.sigil.objectStore.s3.useAWSSDKAuth | quote }}
{{- if $root.Values.sigil.objectStore.s3.accessKey }}
- name: SIGIL_OBJECT_STORE_ACCESS_KEY
  value: {{ $root.Values.sigil.objectStore.s3.accessKey | quote }}
{{- else if and $root.Values.minio.enabled (eq (lower $root.Values.sigil.objectStore.backend) "s3") }}
- name: SIGIL_OBJECT_STORE_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "sigil.minio.secretName" $root }}
      key: {{ $root.Values.minio.secretKeys.rootUser }}
{{- end }}
{{- if $root.Values.sigil.objectStore.s3.secretKey }}
- name: SIGIL_OBJECT_STORE_SECRET_KEY
  value: {{ $root.Values.sigil.objectStore.s3.secretKey | quote }}
{{- else if and $root.Values.minio.enabled (eq (lower $root.Values.sigil.objectStore.backend) "s3") }}
- name: SIGIL_OBJECT_STORE_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "sigil.minio.secretName" $root }}
      key: {{ $root.Values.minio.secretKeys.rootPassword }}
{{- end }}
- name: SIGIL_OBJECT_STORE_GCS_BUCKET
  value: {{ $root.Values.sigil.objectStore.gcs.bucket | quote }}
- name: SIGIL_OBJECT_STORE_GCS_SERVICE_ACCOUNT
  value: {{ $root.Values.sigil.objectStore.gcs.serviceAccount | quote }}
- name: SIGIL_OBJECT_STORE_GCS_USE_GRPC
  value: {{ ternary "true" "false" $root.Values.sigil.objectStore.gcs.useGRPC | quote }}
- name: SIGIL_OBJECT_STORE_AZURE_CONTAINER
  value: {{ $root.Values.sigil.objectStore.azure.container | quote }}
- name: SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT
  value: {{ $root.Values.sigil.objectStore.azure.storageAccountName | quote }}
- name: SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT_KEY
  value: {{ $root.Values.sigil.objectStore.azure.storageAccountKey | quote }}
- name: SIGIL_OBJECT_STORE_AZURE_STORAGE_CONNECTION_STRING
  value: {{ $root.Values.sigil.objectStore.azure.storageConnectionString | quote }}
- name: SIGIL_OBJECT_STORE_AZURE_ENDPOINT
  value: {{ $root.Values.sigil.objectStore.azure.endpoint | quote }}
- name: SIGIL_OBJECT_STORE_AZURE_CREATE_CONTAINER
  value: {{ ternary "true" "false" $root.Values.sigil.objectStore.azure.createContainer | quote }}
- name: SIGIL_COMPACTOR_COMPACT_INTERVAL
  value: {{ $root.Values.sigil.compactor.compactInterval | quote }}
- name: SIGIL_COMPACTOR_TRUNCATE_INTERVAL
  value: {{ $root.Values.sigil.compactor.truncateInterval | quote }}
- name: SIGIL_COMPACTOR_RETENTION
  value: {{ $root.Values.sigil.compactor.retention | quote }}
- name: SIGIL_COMPACTOR_BATCH_SIZE
  value: {{ $root.Values.sigil.compactor.batchSize | quote }}
- name: SIGIL_COMPACTOR_LEASE_TTL
  value: {{ $root.Values.sigil.compactor.leaseTTL | quote }}
- name: SIGIL_COMPACTOR_SHARD_COUNT
  value: {{ $root.Values.sigil.compactor.shardCount | quote }}
- name: SIGIL_COMPACTOR_SHARD_WINDOW_SECONDS
  value: {{ $root.Values.sigil.compactor.shardWindowSeconds | quote }}
- name: SIGIL_COMPACTOR_WORKERS
  value: {{ $root.Values.sigil.compactor.workers | quote }}
- name: SIGIL_COMPACTOR_CYCLE_BUDGET
  value: {{ $root.Values.sigil.compactor.cycleBudget | quote }}
- name: SIGIL_COMPACTOR_CLAIM_TTL
  value: {{ $root.Values.sigil.compactor.claimTTL | quote }}
- name: SIGIL_COMPACTOR_TARGET_BLOCK_BYTES
  value: {{ $root.Values.sigil.compactor.targetBlockBytes | quote }}
- name: SIGIL_MODEL_CARDS_SYNC_INTERVAL
  value: {{ $root.Values.sigil.modelCards.syncInterval | quote }}
- name: SIGIL_MODEL_CARDS_LEASE_TTL
  value: {{ $root.Values.sigil.modelCards.leaseTTL | quote }}
- name: SIGIL_MODEL_CARDS_SOURCE_TIMEOUT
  value: {{ $root.Values.sigil.modelCards.sourceTimeout | quote }}
- name: SIGIL_MODEL_CARDS_STALE_SOFT
  value: {{ $root.Values.sigil.modelCards.staleSoft | quote }}
- name: SIGIL_MODEL_CARDS_STALE_HARD
  value: {{ $root.Values.sigil.modelCards.staleHard | quote }}
- name: SIGIL_MODEL_CARDS_BOOTSTRAP_MODE
  value: {{ $root.Values.sigil.modelCards.bootstrapMode | quote }}
{{- with $root.Values.sigil.extraEnv }}
{{- toYaml . }}
{{- end }}
{{- with .extraEnv }}
{{- toYaml . }}
{{- end }}
{{- end -}}
