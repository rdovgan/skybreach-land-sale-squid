import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, Index as Index_, OneToMany as OneToMany_} from "typeorm"
import {LandSale} from "./landSale.model"
import {PlotOffer} from "./plotOffer.model"

@Entity_()
export class Plot {
  constructor(props?: Partial<Plot>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @Column_("text", {nullable: false})
  owner!: string

  @OneToMany_(() => LandSale, e => e.plot)
  sales!: LandSale[]

  @OneToMany_(() => PlotOffer, e => e.plot)
  offers!: PlotOffer[]
}
