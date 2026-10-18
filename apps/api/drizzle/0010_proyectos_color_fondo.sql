ALTER TABLE "proyectos" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "fondo" jsonb DEFAULT '{"tipo":"ambiente","ambiente":"bosque"}'::jsonb NOT NULL;
