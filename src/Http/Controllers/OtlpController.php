<?php

namespace Lookout\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use JsonException;
use Lookout\Ingest\OtlpSpan;
use Lookout\Ingest\OtlpTraceDecoder;
use Lookout\Lookout;
use Lookout\Services\Sources;
use Opentelemetry\Proto\Collector\Trace\V1\ExportTracePartialSuccess;
use Opentelemetry\Proto\Collector\Trace\V1\ExportTraceServiceResponse;
use RuntimeException;

final class OtlpController
{
    private const PROTOBUF = 'application/x-protobuf';

    private const JSON = 'application/json';

    private const MAX_BYTES = 1_048_576;

    private const MAX_SPANS = 512;

    public function __construct(private Sources $sources, private OtlpTraceDecoder $decoder) {}

    public function __invoke(Request $request): Response
    {
        $mime = strtolower(trim(explode(';', (string) $request->header('Content-Type'), 2)[0]));
        if (! Lookout::enabled() || ! Sources::enabled()) {
            return $this->respond($mime, 404);
        }

        $token = $request->bearerToken() ?? '';
        if (! preg_match('/\A'.Sources::TOKEN.'\z/', $token)) {
            return $this->unauthorized($mime);
        }

        try {
            $source = $this->sources->authenticate($token);
        } catch (RuntimeException $error) {
            return $this->unavailable($mime, $error);
        }
        if ($source === null) {
            return $this->unauthorized($mime);
        }

        $encoding = strtolower(trim((string) $request->header('Content-Encoding')));
        if (! in_array($mime, [self::PROTOBUF, self::JSON], true) || ! in_array($encoding, ['', 'identity', 'gzip'], true)) {
            return $this->respond($mime, 415);
        }

        $body = $request->getContent();
        if (strlen($body) > self::MAX_BYTES) {
            return $this->respond($mime, 413);
        }
        if ($encoding === 'gzip') {
            $body = @gzdecode($body, self::MAX_BYTES + 1);
            if ($body === false) {
                return $this->respond($mime, 400);
            }
            if (strlen($body) > self::MAX_BYTES) {
                return $this->respond($mime, 413);
            }
        }

        $rows = [];
        $rejected = 0;
        try {
            $spans = $mime === self::PROTOBUF ? $this->decoder->protobuf($body) : $this->decoder->json($body);
            foreach ($spans as $index => $span) {
                if ($index >= self::MAX_SPANS) {
                    return $this->respond($mime, 413);
                }

                $row = OtlpSpan::row($span, (int) $source->id);
                if ($row === null) {
                    $rejected++;
                } else {
                    $rows[] = $row;
                }
            }
        } catch (JsonException|InvalidArgumentException) {
            return $this->respond($mime, 400);
        }

        if ($rows !== []) {
            try {
                $this->persist($rows);
            } catch (RuntimeException $error) {
                return $this->unavailable($mime, $error);
            }
        }

        return $this->respond($mime, 200, $rejected);
    }

    private function persist(array $rows): void
    {
        $connection = $this->sources->connection();
        // Batches stay below SQLite's bindings limit. A retry preserves the original row for an existing span.
        $connection->transaction(function () use ($connection, $rows): void {
            foreach (array_chunk($rows, 80) as $chunk) {
                $builder = $connection->table('lookout_spans');
                $keys = ['source_id', 'trace_id', 'span_id'];
                // Unlike insertOrIgnore, this only suppresses the selected conflict and surfaces invalid data.
                $grammar = $connection->getQueryGrammar();
                $sql = $grammar->compileInsert($builder, $chunk).' on conflict ('.$grammar->columnize($keys).') do nothing';
                $connection->insert($sql, array_merge(...array_map(array_values(...), $chunk)));
            }
        });
    }

    private function unauthorized(string $mime): Response
    {
        return $this->respond($mime, 401)->header('WWW-Authenticate', 'Bearer');
    }

    private function unavailable(string $mime, RuntimeException $error): Response
    {
        // Query and connection exceptions can include a statement or connection details.
        Log::warning('Lookout OTLP storage unavailable.', ['exception' => $error::class]);

        return $this->respond($mime, 503)->header('Retry-After', '5');
    }

    private function respond(string $mime, int $status, int $rejected = 0): Response
    {
        // An empty binary message encodes the default RPC Status for HTTP errors.
        $message = new ExportTraceServiceResponse;
        if ($rejected > 0) {
            $message->setPartialSuccess(new ExportTracePartialSuccess(['rejected_spans' => $rejected]));
        }

        $binary = $mime === self::PROTOBUF;

        return response($binary ? $message->serializeToString() : $message->serializeToJsonString(), $status, [
            'Content-Type' => $binary ? self::PROTOBUF : self::JSON,
            'Cache-Control' => 'no-store',
        ]);
    }
}
