module.exports = class Data1657705256654 {
  name = 'Data1657705256654'

  async up(db) {
    await db.query(`CREATE TABLE "land_sale" ("id" character varying NOT NULL, "buyer" text NOT NULL, "seller" text NOT NULL, "price" numeric NOT NULL, "referrer" text NOT NULL, "bought_with_credits" boolean NOT NULL, "txn_hash" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "plot_id" character varying NOT NULL, CONSTRAINT "PK_988cc5b7edf47a7090638f4ca5a" PRIMARY KEY ("id"))`)
    await db.query(`CREATE INDEX "IDX_aadf05dcf50708ca262f269aef" ON "land_sale" ("plot_id") `)
    await db.query(`CREATE INDEX "IDX_6dfd1eeb5332eb86c9616c854b" ON "land_sale" ("buyer") `)
    await db.query(`CREATE INDEX "IDX_4c501df38d6bc33e56aa0bff88" ON "land_sale" ("seller") `)
    await db.query(`CREATE INDEX "IDX_15f5b1d5197a29bfa6a341b1a7" ON "land_sale" ("txn_hash") `)
    await db.query(`CREATE INDEX "IDX_f199c1d4f27c3b47fbc6470742" ON "land_sale" ("created_at") `)
    await db.query(`CREATE TABLE "plot" ("id" character varying NOT NULL, "owner" text NOT NULL, CONSTRAINT "PK_7c22bdc3280a3a5610c63159883" PRIMARY KEY ("id"))`)
    await db.query(`CREATE INDEX "IDX_1702fa1d2c5e53abe8ce06c119" ON "plot" ("owner") `)
    await db.query(`CREATE TABLE "plot_offer" ("id" character varying NOT NULL, "buyer" text NOT NULL, "txn_hash" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "price" numeric NOT NULL, "plot_id" character varying NOT NULL, CONSTRAINT "PK_cf11fd862d08df1f95e7598de78" PRIMARY KEY ("id"))`)
    await db.query(`CREATE INDEX "IDX_f564190897060bd73b56caee03" ON "plot_offer" ("plot_id") `)
    await db.query(`CREATE INDEX "IDX_2e1e3a9edd2d1c89b774867c43" ON "plot_offer" ("buyer") `)
    await db.query(`CREATE INDEX "IDX_72d542ffe33a00aab217cc676f" ON "plot_offer" ("txn_hash") `)
    await db.query(`CREATE INDEX "IDX_e9c7e60ba253d3129d171b09f4" ON "plot_offer" ("created_at") `)
    await db.query(`ALTER TABLE "land_sale" ADD CONSTRAINT "FK_aadf05dcf50708ca262f269aefe" FOREIGN KEY ("plot_id") REFERENCES "plot"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
    await db.query(`ALTER TABLE "plot_offer" ADD CONSTRAINT "FK_f564190897060bd73b56caee031" FOREIGN KEY ("plot_id") REFERENCES "plot"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
  }

  async down(db) {
    await db.query(`DROP TABLE "land_sale"`)
    await db.query(`DROP INDEX "public"."IDX_aadf05dcf50708ca262f269aef"`)
    await db.query(`DROP INDEX "public"."IDX_6dfd1eeb5332eb86c9616c854b"`)
    await db.query(`DROP INDEX "public"."IDX_4c501df38d6bc33e56aa0bff88"`)
    await db.query(`DROP INDEX "public"."IDX_15f5b1d5197a29bfa6a341b1a7"`)
    await db.query(`DROP INDEX "public"."IDX_f199c1d4f27c3b47fbc6470742"`)
    await db.query(`DROP TABLE "plot"`)
    await db.query(`DROP INDEX "public"."IDX_1702fa1d2c5e53abe8ce06c119"`)
    await db.query(`DROP TABLE "plot_offer"`)
    await db.query(`DROP INDEX "public"."IDX_f564190897060bd73b56caee03"`)
    await db.query(`DROP INDEX "public"."IDX_2e1e3a9edd2d1c89b774867c43"`)
    await db.query(`DROP INDEX "public"."IDX_72d542ffe33a00aab217cc676f"`)
    await db.query(`DROP INDEX "public"."IDX_e9c7e60ba253d3129d171b09f4"`)
    await db.query(`ALTER TABLE "land_sale" DROP CONSTRAINT "FK_aadf05dcf50708ca262f269aefe"`)
    await db.query(`ALTER TABLE "plot_offer" DROP CONSTRAINT "FK_f564190897060bd73b56caee031"`)
  }
}
