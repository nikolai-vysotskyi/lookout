<?php

namespace Lookout\Console;

use Illuminate\Console\Command;
use Lookout\Services\Sources;
use Symfony\Component\Console\Output\OutputInterface;

final class SourceCommand extends Command
{
    protected $signature = 'lookout:source {project} {service} {--label=} {--project-label=} {--environment=production} {--rotate} {--revoke}';

    protected $description = 'Register an OpenTelemetry service or rotate/revoke its ingest credential';

    public function handle(Sources $sources): int
    {
        if (! Sources::enabled()) {
            $this->error('Lookout sources are disabled.');

            return self::FAILURE;
        }

        $project = (string) $this->argument('project');
        $service = (string) $this->argument('service');
        $environment = (string) $this->option('environment');
        $projectLabel = trim((string) ($this->option('project-label') ?? $project));
        $label = trim((string) ($this->option('label') ?? $service));
        $rotate = $this->option('rotate');
        $revoke = $this->option('revoke');

        if (! preg_match('/\A'.Sources::SLUG.'\z/', $project)
            || ! preg_match('/\A'.Sources::SLUG.'\z/', $service)
            || ! preg_match('/\A[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\z/', $environment)
            || $label === '' || mb_strlen($label) > 100 || $projectLabel === '' || mb_strlen($projectLabel) > 100
            || ($rotate && $revoke)) {
            $this->error('Invalid project, service, environment, label or option.');

            return self::INVALID;
        }

        $db = $sources->connection();
        $token = 'lks_'.bin2hex(random_bytes(32));
        $created = $db->transaction(function () use ($db, $project, $service, $environment, $projectLabel, $label, $rotate, $revoke, $token): bool {
            if (! $rotate && ! $revoke) {
                $db->table('lookout_projects')->insertOrIgnore(['slug' => $project, 'label' => $projectLabel]);

                return $db->table('lookout_sources')->insertOrIgnore([
                    'project' => $project,
                    'slug' => $service,
                    'label' => $label,
                    'connector' => 'otlp',
                    'environment' => $environment,
                    'token_hash' => hash('sha256', $token),
                ]) === 1;
            }

            return $db->table('lookout_sources')->where('project', $project)->where('slug', $service)
                ->where('connector', 'otlp')
                ->update(['token_hash' => $revoke ? null : hash('sha256', $token)]) === 1;
        });

        if (! $created) {
            $this->error($rotate || $revoke ? 'OpenTelemetry service not found.' : 'Service already exists. Use --rotate to issue a new key.');

            return self::FAILURE;
        }

        if (! $revoke) {
            $this->output->writeln($token, OutputInterface::OUTPUT_RAW);
        }

        return self::SUCCESS;
    }
}
