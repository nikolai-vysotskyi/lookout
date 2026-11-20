<?php

namespace Lookout\Console;

use Illuminate\Console\Command;
use Lookout\Services\Sources;

final class PruneSourcesCommand extends Command
{
    protected $signature = 'lookout:prune-sources';

    protected $description = 'Remove old OpenTelemetry spans from the Lookout monitoring database';

    public function handle(Sources $sources): int
    {
        if (! Sources::enabled()) {
            return self::SUCCESS;
        }

        $cutoff = now('UTC')->subDays(max(1, (int) config('lookout.sources.retention_days', 14)));
        $table = $sources->connection()->table('lookout_spans');
        $table->where('started_at', '<', $cutoff)->select('id')->chunkById(5000, function ($rows) use ($table): void {
            $table->getConnection()->table('lookout_spans')->whereIn('id', $rows->pluck('id'))->delete();
        });

        return self::SUCCESS;
    }
}
