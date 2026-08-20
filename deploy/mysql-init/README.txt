Scripts placed here run ONCE, on the first start of an empty data volume.

MySQL's entrypoint executes *.sql, *.sql.gz and *.sh in filename order, after
the database and the application user have been created.

Typical use: restore a dump into a fresh container.

    cp ~/omd-2026-08-19.sql deploy/mysql-init/01-restore.sql
    docker compose -f docker-compose.db.yml --env-file .env.db up -d

They are ignored on every later start, so leaving a file here does not
re-import it. To re-run them the volume must be removed first:

    docker compose -f docker-compose.db.yml down -v

Do NOT put the project's migrations here. They are tracked in
schema_migrations by the migration runner, and running them behind its back
would leave the table saying the schema is empty when it is not.
