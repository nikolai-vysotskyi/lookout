<?php

namespace Lookout\Ingest;

use Opentelemetry\Proto\Trace\V1\Span\SpanKind;
use Opentelemetry\Proto\Trace\V1\Status\StatusCode;

final class OtlpSpan
{
    private const SQL_OPERATIONS = [
        'ALTER', 'ANALYZE', 'BEGIN', 'CALL', 'COMMIT', 'COPY', 'CREATE', 'DELETE', 'DROP', 'EXEC',
        'EXECUTE', 'EXPLAIN', 'INSERT', 'MERGE', 'RELEASE', 'REPLACE', 'RESET', 'ROLLBACK', 'SAVEPOINT',
        'SELECT', 'SET', 'SHOW', 'TRUNCATE', 'UPDATE', 'VACUUM', 'VALUES', 'WITH',
    ];

    private const SQL_SYSTEMS = [
        'postgresql', 'mysql', 'mariadb', 'sqlite', 'microsoft.sql_server', 'mssql', 'oracle', 'db2',
        'cockroachdb', 'other_sql',
    ];

    public static function row(array $span, int $sourceId): ?array
    {
        $traceId = self::identifier($span['traceId'] ?? null, 32);
        $spanId = self::identifier($span['spanId'] ?? null, 16);
        $start = self::timestamp($span['startTimeUnixNano'] ?? null);
        $end = self::timestamp($span['endTimeUnixNano'] ?? null);
        // A misconfigured clock must not permanently mask a worker that has stopped making progress.
        if ($traceId === null || $spanId === null || $start === null || $end === null || $end < $start
            || intdiv($end, 1_000_000_000) > time() + 300) {
            return null;
        }

        $attributes = $span['attributes'];
        $error = $span['status'] === StatusCode::STATUS_CODE_ERROR;
        $operation = self::operationName($attributes['lookout.operation.name'] ?? null);
        $system = $attributes['db.system.name'] ?? $attributes['db.system'] ?? null;
        $query = $span['kind'] === SpanKind::SPAN_KIND_CLIENT && in_array($system, self::SQL_SYSTEMS, true);
        $progress = in_array($span['status'], [StatusCode::STATUS_CODE_UNSET, StatusCode::STATUS_CODE_OK], true)
            && ($attributes['lookout.progress'] ?? false) === true;
        $template = $query ? self::queryTemplate($attributes['lookout.query.template'] ?? null) : null;

        // Trace and exception names, messages, stack traces, connection details, and raw SQL are deliberately not retained.
        $name = match (true) {
            $query => self::sqlOperation($template)
                ?? self::sqlOperation($attributes['db.operation.name'] ?? $attributes['db.operation'] ?? null)
                ?? self::sqlOperation($span['name'])
                ?? 'Query',
            $error => $operation ?? 'Error',
            $progress => $operation ?? 'Worker progress',
            default => $operation ?? 'Operation',
        };

        return [
            'source_id' => $sourceId,
            'trace_id' => $traceId,
            'span_id' => $spanId,
            'started_at' => gmdate('Y-m-d H:i:s', intdiv($start, 1_000_000_000)).sprintf('.%06d', intdiv($start % 1_000_000_000, 1_000)),
            'duration_us' => intdiv($end, 1_000) - intdiv($start, 1_000),
            'kind' => match (true) {
                $query => 'query',
                $error => 'error',
                $progress => 'progress',
                default => 'operation',
            },
            'name' => $name,
            'query_fingerprint' => $query ? hash('sha256', $system."\0".($template ?? $name)) : null,
            'query_text' => $template,
            'error' => $error,
        ];
    }

    private static function identifier(mixed $value, int $length): ?string
    {
        if (! is_string($value) || strlen($value) !== $length || ! ctype_xdigit($value)
            || $value === str_repeat('0', $length)) {
            return null;
        }

        return strtolower($value);
    }

    private static function timestamp(mixed $value): ?int
    {
        if (is_string($value)) {
            $value = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        }

        return is_int($value) && $value > 0 ? $value : null;
    }

    private static function operationName(mixed $value): ?string
    {
        return is_string($value) && preg_match('/\A[a-z][a-z0-9._-]{0,63}\z/', $value) ? $value : null;
    }

    private static function sqlOperation(mixed $value): ?string
    {
        if (! is_string($value) || ! preg_match('/\A[A-Za-z]{2,12}\b/', $value, $matches)) {
            return null;
        }

        $verb = strtoupper($matches[0]);

        return in_array($verb, self::SQL_OPERATIONS, true) ? $verb : null;
    }

    private static function queryTemplate(mixed $value): ?string
    {
        // Only an instrumentation-supplied, static template can opt in to text storage. Reject quoted strings,
        // comments, literal numbers, and multiple statements even on that path. Never fall back to db.query.text.
        if (! is_string($value) || strlen($value) > 1000 || self::sqlOperation(ltrim($value)) === null
            || str_contains($value, '--') || str_contains($value, '/*')
            || ! preg_match('~\A(?:[A-Za-z_][A-Za-z0-9_]*+|\$[1-9][0-9]*+|:[A-Za-z_][A-Za-z0-9_]*+|::|[?.,()=*<>!+/% \t\r\n-])++\z~D', $value)) {
            return null;
        }

        return preg_replace_callback(
            '~[ \t\r\n]+|\$[1-9][0-9]*|(?<!:):[A-Za-z_][A-Za-z0-9_]*|\b(?:true|false|null)\b~i',
            static fn (array $match): string => ctype_space($match[0][0]) ? ' ' : '?',
            trim($value),
        );
    }
}
