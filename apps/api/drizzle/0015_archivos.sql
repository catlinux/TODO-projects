CREATE TABLE "archivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"tarea_id" uuid,
	"proyecto_id" uuid,
	"nombre" text NOT NULL,
	"mime" text NOT NULL,
	"tamano" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archivos_un_destino" CHECK (("archivos"."tarea_id" is null) <> ("archivos"."proyecto_id" is null))
);
--> statement-breakpoint
ALTER TABLE "archivos" ADD CONSTRAINT "archivos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archivos" ADD CONSTRAINT "archivos_tarea_id_tareas_id_fk" FOREIGN KEY ("tarea_id") REFERENCES "public"."tareas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archivos" ADD CONSTRAINT "archivos_proyecto_id_proyectos_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."proyectos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archivos_tarea_idx" ON "archivos" USING btree ("tarea_id");--> statement-breakpoint
CREATE INDEX "archivos_proyecto_idx" ON "archivos" USING btree ("proyecto_id");