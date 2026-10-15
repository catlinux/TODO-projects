CREATE TABLE "actividad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_id" uuid,
	"token_nombre" text,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" uuid NOT NULL,
	"antes" jsonb,
	"despues" jsonb,
	"deshecho_en" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actividad" ADD CONSTRAINT "actividad_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actividad" ADD CONSTRAINT "actividad_token_id_tokens_api_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens_api"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actividad_usuario_created_idx" ON "actividad" USING btree ("usuario_id","created_at" DESC NULLS LAST);
