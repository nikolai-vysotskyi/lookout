<?php

namespace Lookout\Http\Requests;

use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Lookout\Services\Issues;
use Lookout\Services\Sources;
use Lookout\Services\Window;

/**
 * Query parameters shared by every Lookout endpoint. Access is checked by EnsureLookoutAccess on the route.
 */
class WindowRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'period' => ['nullable', 'in:'.implode(',', array_keys(Window::PERIODS))],
            'from' => ['nullable', 'required_with:to', 'date', 'prohibits:period'],
            'to' => ['nullable', 'required_with:from', 'date', 'after:from'],
            'environment' => ['nullable', 'string', 'max:64'],
            'project' => ['nullable', 'string', 'regex:~\A'.Sources::SLUG.'\z~'],
            'service' => ['nullable', 'string', 'regex:~\A'.Sources::SLUG.'/'.Sources::SLUG.'\z~'],
            'sort' => ['nullable', 'string', 'max:32'],
            'direction' => ['nullable', 'in:asc,desc'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1', 'max:1000'],
            'q' => ['nullable', 'string', 'max:200'],
            'status' => ['nullable', 'in:'.implode(',', Issues::TABS)],
            'priority' => ['nullable', 'in:low,medium,high,none'],
            'assignee' => ['nullable', 'integer'],
            'type' => ['nullable', 'in:exception,performance'],
            'level' => ['nullable', 'string', 'max:20'],
            'filter' => ['nullable', 'in:all,errors'],
            'connection' => ['nullable', 'string', 'max:64'],
            'user' => ['nullable', 'string', 'max:255'],
            'slow_ms' => ['nullable', 'integer', 'min:1', 'max:600000'],
            'min_per_execution' => ['nullable', 'integer', 'min:2', 'max:1000'],
        ];
    }

    public function window(): Window
    {
        if ($this->filled('from')) {
            $from = CarbonImmutable::parse($this->string('from'))->utc();
            $to = CarbonImmutable::parse($this->string('to'))->utc();
            $now = CarbonImmutable::now('UTC');

            if ($from->lt($now->subSeconds(Window::MAX_SECONDS)) || $to->getTimestamp() - $from->getTimestamp() > Window::MAX_SECONDS) {
                throw ValidationException::withMessages(['from' => 'The window may cover at most the last 400 days.']);
            }
            if ($to->gt($now->addHour())) {
                throw ValidationException::withMessages(['to' => 'The window cannot end in the future.']);
            }

            return new Window($from, $to->min($now));
        }

        return Window::period($this->input('period') ?? '24h');
    }

    public function environment(): ?string
    {
        $environment = $this->input('environment');

        return is_string($environment) && $environment !== '' ? $environment : null;
    }

    public function errorsOnly(): bool
    {
        return $this->input('filter') === 'errors';
    }

    public function limit(int $default = 25): int
    {
        return (int) ($this->input('limit') ?? $default);
    }

    public function page(): int
    {
        return (int) ($this->input('page') ?? 1);
    }

    public function direction(): string
    {
        return $this->input('direction') === 'asc' ? 'asc' : 'desc';
    }

    /**
     * The sort key, which must be one of $allowed.
     *
     * @param  list<string>  $allowed
     */
    public function sort(array $allowed, string $default): string
    {
        $sort = $this->input('sort') ?? $default;

        if (! in_array($sort, $allowed, true)) {
            throw ValidationException::withMessages(['sort' => 'Sort by one of: '.implode(', ', $allowed).'.']);
        }

        return $sort;
    }
}
