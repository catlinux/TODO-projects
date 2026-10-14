CREATE TABLE "columnas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proyecto_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"posicion" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "columnas" ("id", "proyecto_id", "nombre", "posicion", "created_at", "updated_at")
SELECT gen_random_uuid(), p."id", c."nombre", c."posicion", now(), now()
FROM "proyectos" p
CROSS JOIN (VALUES ('Pendiente', 0), ('En curso', 1), ('Hecha', 2)) AS c("nombre", "posicion");
--> statement-breakpoint
ALTER TABLE "columnas" ADD CONSTRAINT "columnas_proyecto_id_proyectos_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."proyectos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tareas" ADD COLUMN "columna_id" uuid;
--> statement-breakpoint
ALTER TABLE "tareas" ADD COLUMN "posicion" integer;
--> statement-breakpoint
UPDATE "tareas" t
SET "columna_id" = c."id"
FROM "columnas" c
WHERE c."proyecto_id" = t."proyecto_id"
  AND c."nombre" = CASE t."estado"
    WHEN 'pendiente' THEN 'Pendiente'
    WHEN 'en_curso' THEN 'En curso'
    WHEN 'hecha' THEN 'Hecha'
    ELSE 'Pendiente'
  END;
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "columna_id" ORDER BY "created_at") - 1)::integer AS rn
  FROM "tareas"
)
UPDATE "tareas" t
SET "posicion" = ranked.rn
FROM ranked
WHERE t."id" = ranked."id";
--> statement-breakpoint
ALTER TABLE "tareas" ALTER COLUMN "columna_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tareas" ALTER COLUMN "posicion" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_columna_id_columnas_id_fk" FOREIGN KEY ("columna_id") REFERENCES "public"."columnas"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tareas" DROP COLUMN "estado";