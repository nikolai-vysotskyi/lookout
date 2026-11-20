<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Lookout\Services\Sources;

return new class extends Migration
{
    public function getConnection(): string
    {
        return Sources::connectionName();
    }

    public function up(): void
    {
        $project = (string) config('lookout.sources.nightowl_project', 'default');
        $service = (string) config('lookout.sources.nightowl_service', 'laravel');
        if (! preg_match('~\A'.Sources::SLUG.'\z~', $project) || ! preg_match('~\A'.Sources::SLUG.'\z~', $service)) {
            throw new InvalidArgumentException('NightOwl project and service identifiers must be valid Lookout slugs.');
        }

        $schema = Schema::connection($this->getConnection());

        $schema->create('lookout_projects', function (Blueprint $table): void {
            $table->string('slug', 64)->primary();
            $table->string('label', 100);
        });

        $schema->create('lookout_sources', function (Blueprint $table): void {
            $table->id();
            $table->string('project', 64);
            $table->foreign('project')->references('slug')->on('lookout_projects');
            $table->string('slug', 64);
            $table->string('label', 100);
            $table->string('connector', 16);
            $table->string('environment', 64)->nullable();
            $table->string('token_hash', 64)->nullable()->unique();
            $table->boolean('existing_nightowl')->nullable()->unique();
            $table->unique(['project', 'slug']);
        });

        $schema->create('lookout_spans', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('source_id')->constrained('lookout_sources');
            $table->string('trace_id', 32);
            $table->string('span_id', 16);
            $table->timestamp('started_at', 6);
            $table->unsignedBigInteger('duration_us');
            $table->string('kind', 16);
            $table->string('name', 128);
            $table->string('query_fingerprint', 64)->nullable();
            $table->string('query_text', 1000)->nullable();
            $table->boolean('error');
            $table->unique(['source_id', 'trace_id', 'span_id']);
            $table->index(['source_id', 'kind', 'started_at'], 'lookout_spans_activity');
            $table->index(['source_id', 'query_fingerprint', 'started_at'], 'lookout_spans_query');
            $table->index('started_at');
        });

        $connection = DB::connection($this->getConnection());
        $connection->table('lookout_projects')->insert([
            'slug' => $project,
            'label' => (string) (config('lookout.sources.nightowl_project_label') ?: config('app.name')),
        ]);
        $connection->table('lookout_sources')->insert([
            'project' => $project,
            'slug' => $service,
            'label' => (string) config('lookout.sources.nightowl_service_label', 'Laravel'),
            'connector' => 'nightowl',
            'existing_nightowl' => true,
        ]);
    }

    public function down(): void
    {
        $schema = Schema::connection($this->getConnection());
        $schema->dropIfExists('lookout_spans');
        $schema->dropIfExists('lookout_sources');
        $schema->dropIfExists('lookout_projects');
    }
};
