import { lookupArchive } from '@subsquid/archive-registry';
import { Store, TypeormDatabase } from '@subsquid/typeorm-store';
import {
  BatchContext,
  BatchProcessorItem,
  EvmLogEvent,
  SubstrateBatchProcessor,
  SubstrateBlock,
} from '@subsquid/substrate-processor';
import { AddressZero } from '@ethersproject/constants';
import { CHAIN_NODE, contract } from './contract';
import { LandSale, Plot, PlotOffer } from './model';
import * as landSalesAbi from './abi/landSales';

const database = new TypeormDatabase();
const processor = new SubstrateBatchProcessor()
  .setBatchSize(500)
  .setBlockRange({ from: 2039880 })
  .setDataSource({
    chain: CHAIN_NODE,
    archive: lookupArchive('moonriver', { release: 'FireSquid' }),
  })
  .setTypesBundle('moonbeam')
  .addEvmLog(contract.address, {
    filter: [
      landSalesAbi.events['PlotsBought(uint256[],address,address,bool)'].topic,
      landSalesAbi.events['PlotPurchased(uint256,address,address,uint256)'].topic,
      landSalesAbi.events['OfferMade(uint256,address,uint256)'].topic,
      landSalesAbi.events['OfferCancelled(uint256,address,uint256)'].topic,
      landSalesAbi.events['PlotTransferred(uint256,address,address)'].topic,
    ],
  });

type Item = BatchProcessorItem<typeof processor>;
type Context = BatchContext<Store, Item>;

processor.run(database, async (ctx) => {
  let landSales: LandSale[] = [];
  let plotEntities: Plot[] = [];
  let plotOffers: PlotOffer[] = [];
  const offersToRemove: PlotOffer[] = [];

  for (const block of ctx.blocks) {
    for (const item of block.items) {
      if (item.name === 'EVM.Log') {
        const primarySales = await handlePrimarySaleEvents(ctx, block.header, item.event);
        landSales = landSales.concat(primarySales.landSales);
        plotEntities = plotEntities.concat(primarySales.plotEntities);
        const secondarySales = await handleSecondarySaleEvents(ctx, block.header, item.event, plotEntities);
        plotEntities = secondarySales.plotEntities;
        landSales = landSales.concat(secondarySales.landSales);
        plotEntities = await handleLandTransferEvents(ctx, block.header, item.event, plotEntities);
        const offers = await handleOfferMadeEvents(ctx, block.header, item.event, plotEntities);
        plotEntities = offers.plotEntities;
        plotOffers = offers.offers;

        const offerToRemove = await handleOfferCancelledEvents(ctx, block.header, item.event);
        if (offerToRemove) {
          offersToRemove.push(offerToRemove);
        }
        const offerToRemoveIndex = plotOffers.findIndex(offer => offer.id === offerToRemove.id);

        if (offerToRemoveIndex > -1) {
          plotOffers.splice(offerToRemoveIndex, 1);
        }
      }
    }
  }

  await ctx.store.save(landSales);
  await ctx.store.save(plotEntities);
  await ctx.store.save(plotOffers);
  await ctx.store.remove(offersToRemove)
});

const handlePrimarySaleEvents = async (
  ctx: Context,
  block: SubstrateBlock,
  event: EvmLogEvent,
): Promise<{ landSales: LandSale[]; plotEntities: Plot[] }> => {
  const { boughtWithCredits, buyer, referrer, plotIds } = landSalesAbi.events[
    'PlotsBought(uint256[],address,address,bool)'
  ].decode(event.args);

  const { store } = ctx;
  const landSales: LandSale[] = [];
  const plotEntities: Plot[] = [];

  for (const plotId of plotIds) {
    const plotIdStr = String(plotId);
    let plot = await store.get(Plot, plotIdStr);
    if (!plot) {
      plot = new Plot({
        id: plotIdStr,
        owner: buyer,
      });
    } else {
      plot.owner = buyer;
    }

    const sale = new LandSale({
      id: `${plotIdStr}-${event.evmTxHash}`,
      plot,
      buyer,
      seller: AddressZero,
      referrer: referrer || AddressZero,
      boughtWithCredits,
      txnHash: event.evmTxHash,
      createdAt: new Date(),
    });
    plotEntities.push(plot);
    landSales.push(sale);
  }

  return { landSales, plotEntities };
};

const handleSecondarySaleEvents = async (
  ctx: Context,
  block: SubstrateBlock,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<{ landSales: LandSale[]; plotEntities: Plot[] }> => {
  const { seller, buyer, price, plotId } = landSalesAbi.events[
    'PlotPurchased(uint256,address,address,uint256)'
  ].decode(event.args);

  const { store } = ctx;
  const landSales: LandSale[] = [];

  const plotIdStr = String(plotId);
  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);

  const plot: Plot =
    existingPlotIndex > -1
      ? plotEntities[existingPlotIndex]
      : (await store.get(Plot, plotIdStr)) ||
        new Plot({
          id: plotIdStr,
        });
  plot.owner = buyer;

  const sale = new LandSale({
    id: `${plotIdStr}-${event.evmTxHash}`,
    plot,
    buyer,
    price: price.toNumber(),
    seller,
    referrer: AddressZero,
    boughtWithCredits: false,
    txnHash: event.evmTxHash,
    createdAt: new Date(),
  });

  if (existingPlotIndex > -1) {
    plotEntities[existingPlotIndex] = plot;
  } else {
    plotEntities.push(plot);
  }

  landSales.push(sale);

  return { landSales, plotEntities };
};

const handleOfferMadeEvents = async (
  ctx: Context,
  block: SubstrateBlock,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<{ offers: PlotOffer[]; plotEntities: Plot[] }> => {
  const { plotId, price, buyer } = landSalesAbi.events['OfferMade(uint256,address,uint256)'].decode(
    event.args,
  );

  const { store } = ctx;
  const offers: PlotOffer[] = [];

  const plotIdStr = String(plotId);
  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);

  const plot: Plot =
    existingPlotIndex > -1
      ? plotEntities[existingPlotIndex]
      : (await store.get(Plot, plotIdStr)) ||
        new Plot({
          id: plotIdStr,
        });

  const offer = new PlotOffer({
    id: `${plotIdStr}-${buyer}-${price.toString()}`,
    price: price.toNumber(),
    plot,
    buyer,
    txnHash: event.evmTxHash,
    createdAt: new Date(),
  });

  if (existingPlotIndex > -1) {
    plotEntities[existingPlotIndex] = plot;
  } else {
    plotEntities.push(plot);
  }

  offers.push(offer);

  return { offers, plotEntities };
};

const handleOfferCancelledEvents = async (
    ctx: Context,
    block: SubstrateBlock,
    event: EvmLogEvent,
): Promise<PlotOffer> => {
  const { plotId, price, buyer } = landSalesAbi.events['OfferCancelled(uint256,address,uint256)'].decode(
      event.args,
  );
  const plotIdStr = String(plotId);
  const offerId = `${plotIdStr}-${buyer}-${price.toString()}`
  const existingOffer = await ctx.store.get(PlotOffer, offerId);
  return existingOffer || new PlotOffer({
    id: offerId
  })
};

const handleLandTransferEvents = async (
  ctx: Context,
  block: SubstrateBlock,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<Plot[]> => {
  const {
    plotIds: plotId,
    oldOwner,
    newOwner,
  } = landSalesAbi.events['PlotTransferred(uint256,address,address)'].decode(event.args);

  const { store } = ctx;

  const plotIdStr = String(plotId);
  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);

  let plot =
    existingPlotIndex > -1 ? plotEntities[existingPlotIndex] : await store.get(Plot, plotIdStr);
  if (!plot) {
    plot = new Plot({
      id: plotIdStr,
      owner: newOwner,
    });
  } else {
    plot.owner = newOwner;
  }

  if (existingPlotIndex > -1) {
    plotEntities[existingPlotIndex] = plot;
  } else {
    plotEntities.push(plot);
  }

  return plotEntities;
};
