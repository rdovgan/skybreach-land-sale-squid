import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_} from "typeorm"
import {Plot} from "./plot.model"

@Entity_()
export class LandSale {
  constructor(props?: Partial<LandSale>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Plot, {nullable: false})
  plot!: Plot

  @Index_()
  @Column_("text", {nullable: false})
  buyer!: string

  @Index_()
  @Column_("text", {nullable: false})
  seller!: string

  @Column_("numeric", {nullable: false})
  price!: number

  @Column_("text", {nullable: false})
  referrer!: string

  @Column_("bool", {nullable: false})
  boughtWithCredits!: boolean

  @Index_()
  @Column_("text", {nullable: false})
  txnHash!: string

  @Index_()
  @Column_("timestamp with time zone", {nullable: false})
  createdAt!: Date
}
