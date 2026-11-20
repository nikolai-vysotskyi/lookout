# Projects and telemetry connectors

A Lookout installation can monitor several projects in one PostgreSQL monitoring database. A project groups services. A service is a producer such as a Laravel app, an HTTP server, a worker or a scheduled command. Its connector is the way it sends data.

The existing NightOwl data is attached to one service when you enable projects. Other services can send OpenTelemetry traces to Lookout. Queries and Worker progress let you filter by project, service, environment and period. The existing NightOwl views such as Requests, Jobs and Issues continue to show Laravel activity.

## Enable projects

Set these values on the Laravel app that hosts Lookout. Pick the NightOwl project and service identifiers before the initial migration.

```dotenv
LOOKOUT_SOURCES_ENABLED=true
LOOKOUT_NIGHTOWL_PROJECT=assetfeed
LOOKOUT_NIGHTOWL_PROJECT_LABEL=AssetFeed
LOOKOUT_NIGHTOWL_SERVICE=laravel
LOOKOUT_NIGHTOWL_SERVICE_LABEL="Laravel API"
```

Clear or refresh the config cache before running `php artisan migrate`. Rebuild the route cache after the migration if you use it. The migration links existing NightOwl history to the configured service and creates `lookout_projects`, `lookout_sources` and `lookout_spans` in the monitoring database. It uses the `lookout_ingest` connection, which defaults to NightOwl's PostgreSQL settings. Set `LOOKOUT_INGEST_DB_CONNECTION` to use a separate writer role on the same database. If `nightowl_read` uses a restricted role, give it `SELECT` on the new tables.

The recipient URL follows `LOOKOUT_PATH` and the Lookout domain, including the Nova domain in Nova mode. Set `LOOKOUT_INGEST_DOMAIN` if the receiver should be on a different hostname. Use HTTPS and keep the receiver within the network reachable by your producers. The default request limit is 600 per minute per client IP and can be set with `LOOKOUT_INGEST_PER_MINUTE`.

## Register a service

```bash
php artisan lookout:source assetfeed search --label=Search --environment=production
```

If the project does not exist, the command creates it. Pass `--project-label` to set its display name. Use separate service identifiers for different environments. The command prints a service credential once. Store it in the producer's secret store. Use `--rotate` to replace it or `--revoke` to stop new writes while keeping its history. A producer credential cannot read Lookout or MCP.

The service key above is `assetfeed/search`. On the MCP server call `list_sources` to discover the project and service keys. Pass `project`, `service` or `environment` to `slow_queries` and `worker_progress` as needed.

## Write a connector

Use an OpenTelemetry SDK or translate existing telemetry to OTLP. Both can send to the same receiver without writing to the monitoring database or installing PHP on the producer.

1. Send OTLP/HTTP traces to `POST /<lookout-path>/v1/traces` with `Authorization: Bearer <source-token>`, where `<source-token>` is the credential printed by the command. The receiver accepts `application/x-protobuf` and OTLP JSON with `application/json`. Either can be gzip-compressed. The request limits are 1 MiB before and after decompression and 512 spans.
2. Emit valid trace/span IDs, start/end timestamps and a span status. The service credential determines ownership irrespective of OTLP resource labels. Retries should keep the same trace and span IDs so the receiver can deduplicate them per service.
3. Send database client spans using the [OpenTelemetry database conventions](https://opentelemetry.io/docs/specs/semconv/db/database-spans/). Lookout groups SQL by its recognized operation when it has no template. To distinguish two queries with the same verb, set `lookout.query.template` to a static, parameterized template from your code. Use placeholders for every value and keep templates small. Lookout discards ordinary SQL text, bind parameters, exception payloads and resource attributes. It may read the first SQL verb from the span name and discards the rest. Use source-side redaction if the producer may emit sensitive data.
4. Mark a completed worker cycle with the boolean attribute `lookout.progress`. Give it a stable, low-cardinality `lookout.operation.name`, such as `search.indexer`. Lookout keeps the last successful run for that operation. A cycle that exhausts its retries should emit a span with error status. Use the same operation name. Use an ordinary successful progress span when a valid poll completes with no work.
5. Keep export off the worker's critical path. Use the SDK's bounded batch processor and a short export timeout. Configure exporter telemetry or logs so delivery failures are visible to the operator. On `429` or `503`, honor `Retry-After` and retry within the exporter's budget. A successful response can include OTLP `partialSuccess` for rejected spans.

This receiver accepts traces. Use span status and progress attributes for errors and worker health. The retention command `lookout:prune-sources` deletes expired spans daily when the Laravel scheduler is running. Retention defaults to 14 days and can be changed with `LOOKOUT_INGEST_RETENTION_DAYS`. Query counts and percentiles for OpenTelemetry describe received spans, so document any sampling done by the producer. Lookout shows a combined call count for mixed NightOwl and OpenTelemetry buckets and omits a combined p95 where their distributions cannot be merged.

### Python worker example

Install the standard Python SDK and HTTP exporter.

```bash
pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://monitoring.example.com/lookout/v1/traces` and inject `LOOKOUT_SOURCE_TOKEN` from the service's secret store. Use the appropriate OpenTelemetry instrumentor for the database driver (`psycopg` or `asyncpg`), or explicitly instrument operations as below. Use one instrumentation layer per call to avoid duplicate query spans.

```python
import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
    endpoint=os.environ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
    headers={"Authorization": f"Bearer {os.environ['LOOKOUT_SOURCE_TOKEN']}"},
    timeout=3,
)))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("search.indexer")


def index_once(connection, minimum_id):
    with tracer.start_as_current_span("index cycle", attributes={
        "lookout.operation.name": "search.indexer",
        "lookout.progress": True,
    }):
        with tracer.start_as_current_span("read posts", kind=trace.SpanKind.CLIENT, attributes={
            "db.system.name": "postgresql",
            "db.operation.name": "SELECT",
            "lookout.query.template": "SELECT id FROM posts WHERE id > ?",
        }):
            return connection.execute(
                "SELECT id FROM posts WHERE id > %s", (minimum_id,),
            ).fetchall()


# For a long-running worker, call provider.shutdown() during graceful shutdown.
```

The cycle span should cover the complete unit of work. If indexing or checkpointing happens after the read, perform those steps inside the cycle span so progress reflects a committed result.

For another language, use that language's OTLP HTTP trace exporter with the same URL and authorization header. You can also route an existing telemetry pipeline through an OpenTelemetry Collector, using a separate exporter credential for each Lookout service.
