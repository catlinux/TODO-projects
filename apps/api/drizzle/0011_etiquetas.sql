CREATE TABLE "etiquetas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proyecto_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tareas_etiquetas" (
	"tarea_id" uuid NOT NULL,
	"etiqueta_id" uuid NOT NULL,
	CONSTRAINT "tareas_etiquetas_tarea_id_etiqueta_id_pk" PRIMARY KEY("tarea_id","etiqueta_id")
);
--> statement-breakpoint
ALTER TABLE "etiquetas" ADD CONSTRAINT "etiquetas_proyecto_id_proyectos_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."proyectos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tareas_etiquetas" ADD CONSTRAINT "tareas_etiquetas_tarea_id_tareas_id_fk" FOREIGN KEY ("tarea_id") REFERENCES "public"."tareas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tareas_etiquetas" ADD CONSTRAINT "tareas_etiquetas_etiqueta_id_etiquetas_id_fk" FOREIGN KEY ("etiqueta_id") REFERENCES "public"."etiquetas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "etiquetas_proyecto_idx" ON "etiquetas" USING btree ("proyecto_id");