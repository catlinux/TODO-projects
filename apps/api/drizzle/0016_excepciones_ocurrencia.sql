CREATE TABLE "excepciones_ocurrencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tarea_id" uuid NOT NULL,
	"fecha_original" timestamp with time zone NOT NULL,
	"fecha_nueva" timestamp with time zone,
	"omitida" boolean DEFAULT false NOT NULL,
	"titulo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "excepciones_ocurrencia" ADD CONSTRAINT "excepciones_ocurrencia_tarea_id_tareas_id_fk" FOREIGN KEY ("tarea_id") REFERENCES "public"."tareas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "excepciones_ocurrencia_tarea_fecha_idx" ON "excepciones_ocurrencia" USING btree ("tarea_id","fecha_original");--> statement-breakpoint
CREATE INDEX "excepciones_ocurrencia_tarea_idx" ON "excepciones_ocurrencia" USING btree ("tarea_id");