#!/bin/sh
set -e

# Apply pending database migrations, then start the app.
npx prisma migrate deploy
exec node dist/main
