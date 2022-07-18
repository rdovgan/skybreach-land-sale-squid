module.exports = class Data1658138593956 {
  name = 'Data1658138593956'

  async up(db) {
    await db.query(`ALTER TABLE "plot_offer" ADD "cancelled" boolean NOT NULL`)
  }

  async down(db) {
    await db.query(`ALTER TABLE "plot_offer" DROP COLUMN "cancelled"`)
  }
}
