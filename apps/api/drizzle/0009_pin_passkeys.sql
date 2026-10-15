ALTER TABLE "usuarios" ADD COLUMN "pin_hash" text;--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"credencial_id" text NOT NULL,
	"clave_publica" text NOT NULL,
	"algoritmo" integer NOT NULL,
	"contador" bigint DEFAULT 0 NOT NULL,
	"nombre" text NOT NULL,
	"ultimo_uso" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credencial_id_unique" UNIQUE("credencial_id")
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkeys_usuario_idx" ON "passkeys" USING btree ("usuario_id");
