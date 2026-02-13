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
{{- define "sigil.mysql.dsn" -}}
{{- if .Values.sigil.storage.mysql.dsn -}}
{{- .Values.sigil.storage.mysql.dsn -}}
{{- else if .Values.mysql.enabled -}}
{{- printf "%s:%s@tcp(%s:%v)/%s?parseTime=true" .Values.mysql.auth.user .Values.mysql.auth.password (include "sigil.mysql.fullname" .) .Values.mysql.service.port .Values.mysql.auth.database -}}
{{- else -}}
{{- fail "sigil.storage.mysql.dsn must be set when mysql.enabled=false and sigil.storage.backend=mysql" -}}
{{- end -}}
{{- end -}}

{{- define "sigil.tempo.grpcEndpoint" -}}
{{- if .Values.sigil.tempo.grpcEndpoint -}}
{{- .Values.sigil.tempo.grpcEndpoint -}}
{{- else if .Values.tempo.enabled -}}
{{- printf "%s:%v" (include "sigil.tempo.fullname" .) .Values.tempo.service.ports.grpc -}}
{{- else -}}
tempo:4317
{{- end -}}
{{- end -}}

{{- define "sigil.tempo.httpEndpoint" -}}
{{- if .Values.sigil.tempo.httpEndpoint -}}
{{- .Values.sigil.tempo.httpEndpoint -}}
{{- else if .Values.tempo.enabled -}}
{{- printf "%s:%v" (include "sigil.tempo.fullname" .) .Values.tempo.service.ports.http -}}
{{- else -}}
tempo:4318
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
