ALTER TABLE "archivos" DROP CONSTRAINT "archivos_un_destino";--> statement-breakpoint
ALTER TABLE "archivos" ADD COLUMN "biblioteca" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "archivos_biblioteca_usuario_idx" ON "archivos" USING btree ("usuario_id","biblioteca");--> statement-breakpoint
ALTER TABLE "archivos" ADD CONSTRAINT "archivos_un_destino" CHECK ((("archivos"."tarea_id" is not null)::int + ("archivos"."proyecto_id" is not null)::int + "archivos"."biblioteca"::int) = 1);