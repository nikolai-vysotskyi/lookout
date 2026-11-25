<?php

namespace Lookout\Tests\Feature;

use Illuminate\Support\Facades\DB;
use Lookout\Tests\TestCase;
use Opentelemetry\Proto\Collector\Trace\V1\ExportTraceServiceRequest;
use Opentelemetry\Proto\Collector\Trace\V1\ExportTraceServiceResponse;
use Opentelemetry\Proto\Common\V1\AnyValue;
use Opentelemetry\Proto\Common\V1\KeyValue;
use Opentelemetry\Proto\Trace\V1\ResourceSpans;
use Opentelemetry\Proto\Trace\V1\ScopeSpans;
use Opentelemetry\Proto\Trace\V1\Span;

final class OtlpIngestTest extends TestCase
{
    private string $token = 'lks_'.'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private string $secondToken = 'lks_'.'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);

        $app['config']->set([
            'lookout.connection' => 'testing',
            'lookout.sources.enabled' => true,
            'lookout.sources.connection' => 'testing',
        ]);
    }

    protected function defineDatabaseMigrations(): void
    {
        parent::defineDatabaseMigrations();
        $this->loadMigrationsFrom(__DIR__.'/../../database/sources');
    }

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('lookout_projects')->insert(['slug' => 'assets', 'label' => 'Asset tools']);
        DB::table('lookout_sources')->insert([
            ['project' => 'assets', 'slug' => 'search', 'label' => 'Search', 'connector' => 'otlp', 'environment' => 'production', 'token_hash' => hash('sha256', $this->token)],
            ['project' => 'assets', 'slug' => 'parser', 'label' => 'Parser', 'connector' => 'otlp', 'environment' => 'production', 'token_hash' => hash('sha256', $this->secondToken)],
        ]);
    }

    public function test_otlp_protobuf_can_be_retried_without_overcounting_and_is_scoped_by_credential(): void
    {
        $start = (time() - 1) * 1_000_000_000;
        $span = new Span([
            'trace_id' => str_repeat('t', 16),
            'span_id' => str_repeat('s', 8),
            'name' => 'SELECT a secret raw statement',
            'kind' => 3,
            'start_time_unix_nano' => $start,
            'end_time_unix_nano' => $start + 123_000,
            'attributes' => [
                new KeyValue(['key' => 'db.system', 'value' => new AnyValue(['string_value' => 'postgresql'])]),
                new KeyValue(['key' => 'db.statement', 'value' => new AnyValue(['string_value' => "SELECT 'private value'"])]),
                new KeyValue(['key' => 'lookout.query.template', 'value' => new AnyValue(['string_value' => 'SELECT id FROM posts WHERE id = $1'])]),
            ],
        ]);
        $body = (new ExportTraceServiceRequest([
            'resource_spans' => [new ResourceSpans([
                'scope_spans' => [new ScopeSpans(['spans' => [$span]])],
            ])],
        ]))->serializeToString();

        $this->export($this->token, gzencode($body), 'application/x-protobuf', 'gzip')
            ->assertOk()->assertHeader('Content-Type', 'application/x-protobuf')->assertContent('');
        $this->export($this->token, $body, 'application/x-protobuf')->assertOk();
        $this->export($this->secondToken, $body, 'application/x-protobuf')->assertOk();

        $rows = DB::table('lookout_spans')->orderBy('source_id')->get();
        $this->assertCount(2, $rows);
        $this->assertNotSame($rows[0]->source_id, $rows[1]->source_id);
        foreach ($rows as $row) {
            $this->assertSame('query', $row->kind);
            $this->assertSame('SELECT', $row->name);
            $this->assertSame('SELECT id FROM posts WHERE id = ?', $row->query_text);
            $this->assertSame(123, $row->duration_us);
            $this->assertSame(bin2hex(str_repeat('t', 16)), $row->trace_id);
        }
    }

    public function test_otlp_json_keeps_safe_worker_progress_and_errors_and_reports_invalid_spans(): void
    {
        $start = (time() - 1) * 1_000_000_000;
        $base = [
            'traceId' => str_repeat('AB', 16),
            'spanId' => str_repeat('CD', 8),
            'startTimeUnixNano' => (string) $start,
            'endTimeUnixNano' => (string) ($start + 1_000_000),
            'name' => 'A private operation name',
            'unknownFutureField' => 'Ignored',
        ];
        $progress = [
            ['key' => 'lookout.operation.name', 'value' => ['stringValue' => 'indexer.cycle']],
            ['key' => 'lookout.progress', 'value' => ['boolValue' => true]],
        ];
        $response = $this->export($this->token, $this->jsonSpans([
            $base + ['attributes' => $progress],
            array_replace($base, [
                'spanId' => str_repeat('EF', 8),
                'status' => ['code' => 2, 'message' => 'private exception text'],
                'attributes' => $progress,
            ]),
            array_replace($base, [
                'spanId' => str_repeat('FE', 8),
                'kind' => 3,
                'status' => ['code' => 2],
                'attributes' => [
                    ['key' => 'db.system.name', 'value' => ['stringValue' => 'postgresql']],
                    ['key' => 'db.operation.name', 'value' => ['stringValue' => 'SELECT']],
                    ['key' => 'db.query.text', 'value' => ['stringValue' => "SELECT 'private raw value'"]],
                    ['key' => 'lookout.query.template', 'value' => ['stringValue' => "SELECT 'private value'"]],
                ],
            ]),
            array_replace($base, ['spanId' => str_repeat('00', 8)]),
        ]));
        $response->assertOk()->assertHeader('Content-Type', 'application/json');
        $result = new ExportTraceServiceResponse;
        $result->mergeFromJsonString($response->getContent());
        $this->assertSame(1, (int) $result->getPartialSuccess()->getRejectedSpans());

        $rows = DB::table('lookout_spans')->orderBy('id')->get()->all();
        $this->assertSame(['progress', 'error', 'query'], array_column($rows, 'kind'));
        $this->assertSame(['indexer.cycle', 'indexer.cycle', 'SELECT'], array_column($rows, 'name'));
        $this->assertSame([0, 1, 1], array_column($rows, 'error'));
        $this->assertSame([null, null, null], array_column($rows, 'query_text'));
        $this->assertSame(str_repeat('ab', 16), $rows[0]->trace_id);
    }

    public function test_otlp_rejects_missing_credentials_malformed_payloads_and_oversized_batches(): void
    {
        $this->actingAs($this->admin());
        $this->export('', '{}')->assertUnauthorized()->assertHeader('WWW-Authenticate', 'Bearer');
        $this->export('lks_'.str_repeat('c', 64), '{}')->assertUnauthorized();
        $this->export($this->token, '{}', 'text/plain')->assertStatus(415);
        $this->export($this->token, '{')->assertBadRequest();
        $this->export($this->token, "\x0a\x01", 'application/x-protobuf')->assertBadRequest();
        $this->export($this->token, str_repeat(' ', 1_048_577))->assertStatus(413);
        $this->export($this->token, $this->jsonSpans(array_fill(0, 513, [])))->assertStatus(413);
        $this->assertSame(0, DB::table('lookout_spans')->count());
    }

    public function test_otlp_distinguishes_an_empty_export_and_a_fully_rejected_batch(): void
    {
        $this->export($this->token, '{}')->assertOk()->assertContent('{}');
        $this->export($this->token, $this->jsonSpans([[]]))->assertOk()
            ->assertJsonPath('partialSuccess.rejectedSpans', '1');
        $this->assertSame(0, DB::table('lookout_spans')->count());

        config(['lookout.sources.enabled' => false]);
        $this->export($this->token, '{}')->assertNotFound();
    }

    public function test_otlp_uses_a_retryable_failure_for_unavailable_storage(): void
    {
        DB::connection('testing')->getSchemaBuilder()->drop('lookout_spans');
        $start = (time() - 1) * 1_000_000_000;
        $this->export($this->token, $this->jsonSpans([[
            'traceId' => str_repeat('aa', 16),
            'spanId' => str_repeat('bb', 8),
            'startTimeUnixNano' => (string) $start,
            'endTimeUnixNano' => (string) $start,
        ]]))->assertStatus(503)->assertHeader('Retry-After', '5');
    }

    public function test_otlp_server_spans_become_routes_with_their_status_and_never_keep_the_raw_url(): void
    {
        $start = (time() - 1) * 1_000_000_000;
        $span = fn (string $id, array $attributes, array $extra = []): array => array_replace([
            'traceId' => str_repeat('12', 16),
            'spanId' => str_repeat($id, 8),
            'kind' => 2,
            'startTimeUnixNano' => (string) $start,
            'endTimeUnixNano' => (string) ($start + 250_000_000),
            'name' => 'GET /stocks/AAPL?token=private',
            'attributes' => $attributes,
        ], $extra);
        $http = fn (string $method, string $route, int|string $status): array => [
            ['key' => 'http.request.method', 'value' => ['stringValue' => $method]],
            ['key' => 'http.route', 'value' => ['stringValue' => $route]],
            ['key' => 'http.response.status_code', 'value' => ['intValue' => $status]],
            ['key' => 'url.full', 'value' => ['stringValue' => 'https://example.test/stocks/AAPL?token=private']],
        ];

        $this->export($this->token, $this->jsonSpans([
            $span('a1', $http('GET', '/stocks/[symbol]', '200')),
            $span('a2', $http('GET', '/stocks/[symbol]', 404)),
            $span('a3', $http('POST', '/api/_rum', 502)),
            // Not a route: a raw URL with a query string, an unknown method, a client span.
            $span('a4', $http('GET', '/stocks/AAPL?token=private', 200)),
            $span('a5', $http('BREW', '/coffee', 200)),
            $span('a6', $http('GET', '/stocks/[symbol]', 200), ['kind' => 3]),
        ]))->assertOk();

        $rows = DB::table('lookout_spans')->orderBy('span_id')->get()->keyBy('span_id');
        $this->assertSame(['request', 'GET /stocks/[symbol]', 200, 0], [$rows[str_repeat('a1', 8)]->kind, $rows[str_repeat('a1', 8)]->name, (int) $rows[str_repeat('a1', 8)]->status_code, (int) $rows[str_repeat('a1', 8)]->error]);
        $this->assertSame([404, 0], [(int) $rows[str_repeat('a2', 8)]->status_code, (int) $rows[str_repeat('a2', 8)]->error]);
        $this->assertSame(['POST /api/_rum', 502, 1], [$rows[str_repeat('a3', 8)]->name, (int) $rows[str_repeat('a3', 8)]->status_code, (int) $rows[str_repeat('a3', 8)]->error]);
        foreach (['a4', 'a5', 'a6'] as $id) {
            $this->assertSame('operation', $rows[str_repeat($id, 8)]->kind);
            $this->assertNull($rows[str_repeat($id, 8)]->status_code);
        }
        $this->assertSame(250_000, (int) $rows[str_repeat('a1', 8)]->duration_us);
        $this->assertFalse(DB::table('lookout_spans')->where('name', 'like', '%private%')->exists());
    }

    private function export(string $token, string $body, string $type = 'application/json', string $encoding = 'identity')
    {
        return $this->call('POST', '/lookout/v1/traces', server: [
            'HTTP_AUTHORIZATION' => 'Bearer '.$token,
            'CONTENT_TYPE' => $type,
            'HTTP_CONTENT_ENCODING' => $encoding,
        ], content: $body);
    }

    private function jsonSpans(array $spans): string
    {
        return json_encode(['resourceSpans' => [['scopeSpans' => [['spans' => $spans]]]]], JSON_THROW_ON_ERROR);
    }
}
