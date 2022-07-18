import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_} from "typeorm"
import * as marshal from "./marshal"
import {Plot} from "./plot.model"

@Entity_()
export class PlotOffer {
  constructor(props?: Partial<PlotOffer>) {
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
  txnHash!: string

  @Index_()
  @Column_("timestamp with time zone", {nullable: false})
  createdAt!: Date

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  price!: bigint

  @Index_()
  @Column_("text", {nullable: false})
  parentPlotId!: string

  @Column_("bool", {nullable: false})
  cancelled!: boolean
}
