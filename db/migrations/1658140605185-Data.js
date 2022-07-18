module.exports = class Data1658140605185 {
  name = 'Data1658140605185'

  async up(db) {
    await db.query(`ALTER TABLE "plot_offer" ALTER COLUMN "cancelled" DROP NOT NULL`)
  }

  async down(db) {
    await db.query(`ALTER TABLE "plot_offer" ALTER COLUMN "cancelled" SET NOT NULL`)
  }
}
