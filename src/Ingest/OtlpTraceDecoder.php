<?php

namespace Lookout\Ingest;

use Exception;
use Generator;
use InvalidArgumentException;
use Opentelemetry\Proto\Collector\Trace\V1\ExportTraceServiceRequest;

final class OtlpTraceDecoder
{
    private const ATTRIBUTES = [
        'db.system',
        'db.system.name',
        'db.operation',
        'db.operation.name',
        'lookout.operation.name',
        'lookout.progress',
        'lookout.query.template',
    ];

    /** @return Generator<array> */
    public function protobuf(string $body): Generator
    {
        $request = new ExportTraceServiceRequest;
        try {
            $request->mergeFromString($body);
        } catch (Exception $error) {
            throw new InvalidArgumentException('Malformed OTLP protobuf payload.', previous: $error);
        }

        foreach ($request->getResourceSpans() as $resource) {
            foreach ($resource->getScopeSpans() as $scope) {
                foreach ($scope->getSpans() as $span) {
                    $attributes = [];
                    foreach ($span->getAttributes() as $attribute) {
                        $key = $attribute->getKey();
                        $value = $attribute->getValue();
                        if (in_array($key, self::ATTRIBUTES, true) && $value !== null) {
                            $attributes[$key] = match ($value->getValue()) {
                                'string_value' => $value->getStringValue(),
                                'bool_value' => $value->getBoolValue(),
                                default => null,
                            };
                        }
                    }

                    yield [
                        'traceId' => bin2hex($span->getTraceId()),
                        'spanId' => bin2hex($span->getSpanId()),
                        'startTimeUnixNano' => $span->getStartTimeUnixNano(),
                        'endTimeUnixNano' => $span->getEndTimeUnixNano(),
                        'name' => $span->getName(),
                        'kind' => $span->getKind(),
                        'status' => $span->getStatus()?->getCode() ?? 0,
                        'attributes' => $attributes,
                    ];
                }
            }
        }
    }

    /** @return Generator<array> */
    public function json(string $body): Generator
    {
        $request = json_decode($body, depth: 32, flags: JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        if (! is_object($request)) {
            throw new InvalidArgumentException('Malformed OTLP JSON payload.');
        }

        foreach ($this->list($request, 'resourceSpans') as $resource) {
            foreach ($this->list($resource, 'scopeSpans') as $scope) {
                foreach ($this->list($scope, 'spans') as $span) {
                    if (! is_object($span)) {
                        yield [];

                        continue;
                    }

                    $attributes = [];
                    foreach ($this->list($span, 'attributes') as $attribute) {
                        $key = $attribute->key ?? null;
                        if (in_array($key, self::ATTRIBUTES, true)) {
                            $attributes[$key] = $attribute->value->stringValue ?? $attribute->value->boolValue ?? null;
                        }
                    }

                    yield [
                        'traceId' => $span->traceId ?? null,
                        'spanId' => $span->spanId ?? null,
                        'startTimeUnixNano' => $span->startTimeUnixNano ?? null,
                        'endTimeUnixNano' => $span->endTimeUnixNano ?? null,
                        'name' => $span->name ?? null,
                        'kind' => $span->kind ?? null,
                        'status' => $span->status->code ?? 0,
                        'attributes' => $attributes,
                    ];
                }
            }
        }
    }

    private function list(mixed $message, string $field): array
    {
        if (! is_object($message) || ! is_array($message->{$field} ?? [])) {
            throw new InvalidArgumentException('Malformed OTLP JSON message.');
        }

        return $message->{$field} ?? [];
    }
}
