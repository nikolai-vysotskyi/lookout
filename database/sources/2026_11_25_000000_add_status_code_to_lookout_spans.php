<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Lookout\Services\Sources;

/**
 * The HTTP status of a request span (kind "request"), so a route can count its 4xx answers. A nullable column without a
 * default: PostgreSQL adds it without rewriting the table.
 */
return new class extends Migration
{
    public function getConnection(): string
    {
        return Sources::connectionName();
    }

    public function up(): void
    {
        Schema::connection($this->getConnection())->table('lookout_spans', function (Blueprint $table): void {
            $table->unsignedSmallInteger('status_code')->nullable();
        });
    }

    public function down(): void
    {
        $schema = Schema::connection($this->getConnection());
        // The sources migration drops lookout_spans first on a full rollback.
        if ($schema->hasColumn('lookout_spans', 'status_code')) {
            $schema->table('lookout_spans', function (Blueprint $table): void {
                $table->dropColumn('status_code');
            });
        }
    }
};
