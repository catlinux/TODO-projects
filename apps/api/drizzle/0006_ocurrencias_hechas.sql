CREATE TABLE "ocurrencias_hechas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tarea_id" uuid NOT NULL,
	"ocurrencia" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocurrencias_hechas" ADD CONSTRAINT "ocurrencias_hechas_tarea_id_tareas_id_fk" FOREIGN KEY ("tarea_id") REFERENCES "public"."tareas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocurrencias_hechas_tarea_ocurrencia_idx" ON "ocurrencias_hechas" USING btree ("tarea_id","ocurrencia");
