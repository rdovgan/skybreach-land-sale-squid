import { BigNumber } from 'ethers';
import { lookupArchive } from '@subsquid/archive-registry';
import { Store, TypeormDatabase } from '@subsquid/typeorm-store';
import {
  BatchContext,
  BatchProcessorItem,
  EvmLogEvent,
  SubstrateBatchProcessor,
} from '@subsquid/substrate-processor';
import { AddressZero } from '@ethersproject/constants';
import { CHAIN_NODE, contractNew, contractOld, contractXcRMRK, isMoonbaseAlpha } from './contract';
import { LandSale, Plot, PlotOffer } from './model';
import * as landSalesAbi from './abi/landSales';
import * as landSalesOldAbi from './abi/landSaleOld';
import * as xcRMRKAbi from './abi/xcRMRK';
import {
  OfferCancelled0Event,
  OfferMade0Event,
  PlotDelisted0Event,
  PlotListed0Event,
  PlotPriceChanged0Event,
  PlotPurchased0Event,
  PlotsBought0Event,
  PlotTransferred0Event,
} from './abi/landSales';

const LAND_SALE_EVENTS = {
  primarySale: landSalesAbi.events['PlotsBought(uint256[],address,address,bool)'],
  secondarySale: landSalesAbi.events['PlotPurchased(uint256,address,address,uint256)'],
  plotTransfer: landSalesAbi.events['PlotTransferred(uint256,address,address)'],
  offerMade: landSalesAbi.events['OfferMade(uint256,address,uint256)'],
  offerCancelled: landSalesAbi.events['OfferCancelled(uint256,address,uint256)'],
  plotListedForSale: landSalesAbi.events['PlotListed(uint256,address,uint256)'],
  plotDeListedForSale: landSalesAbi.events['PlotDelisted(uint256,address)'],
  plotPriceChanged: landSalesAbi.events['PlotPriceChanged(uint256,address,uint256,uint256)'],
};

const LAND_SALE_EVENTS_OLD = {
  primarySale: landSalesOldAbi.events['PlotsBought(uint256[],address,address,bool)'],
  secondarySale: landSalesOldAbi.events['PlotPurchased(uint256,address,address,uint256)'],
  plotTransfer: landSalesOldAbi.events['PlotTransferred(uint256,address,address)'],
  offerMade: landSalesOldAbi.events['OfferMade(uint256,address,uint256)'],
  offerCancelled: landSalesOldAbi.events['OfferCancelled(uint256,address,uint256)'],
  plotListedForSale: landSalesAbi.events['PlotListed(uint256,address,uint256)'],
  plotDeListedForSale: landSalesAbi.events['PlotDelisted(uint256,address)'],
  plotPriceChanged: landSalesAbi.events['PlotPriceChanged(uint256,address,uint256,uint256)'],
};

const XCRMRK_TRANSFER_EVENT = xcRMRKAbi.events['Transfer(address,address,uint256)'];

const database = new TypeormDatabase();
const processor = new SubstrateBatchProcessor()
  .setBatchSize(500)
  .setBlockRange({ from: isMoonbaseAlpha ? 2309113 : 2039880 })
  .setDataSource({
    chain: CHAIN_NODE,
    archive: lookupArchive(isMoonbaseAlpha ? 'moonbase' : 'moonriver', { release: 'FireSquid' }),
  })
  .setTypesBundle('moonbeam')
  .addEvmLog(contractOld, {
    filter: [Object.values(LAND_SALE_EVENTS_OLD).map((event) => event.topic)],
  })
  .addEvmLog(contractNew, {
    filter: [Object.values(LAND_SALE_EVENTS).map((event) => event.topic)],
  })
  .addEvmLog(contractXcRMRK, {
    filter: [XCRMRK_TRANSFER_EVENT.topic],
  });

type Item = BatchProcessorItem<typeof processor>;
type Context = BatchContext<Store, Item>;

async function processBatches(ctx: Context) {
  const xcRmrkTransferValues: Record<string, BigNumber> = {};
  const landSaleEvents: EvmLogEvent[] = [];

  for (const block of ctx.blocks) {
    for (const item of block.items) {
      if (item.name === 'EVM.Log') {
        const topic = item.event.args.topics[0];

        if (topic === XCRMRK_TRANSFER_EVENT.topic) {
          const { value } = XCRMRK_TRANSFER_EVENT.decode(item.event.args);

          if (!xcRmrkTransferValues[item.event.evmTxHash]) {
            xcRmrkTransferValues[item.event.evmTxHash] = BigNumber.from(0);
          }

          xcRmrkTransferValues[item.event.evmTxHash] =
            xcRmrkTransferValues[item.event.evmTxHash].add(value);
        }

        if (
          Object.values(LAND_SALE_EVENTS)
            .map((event) => event.topic)
            .includes(topic) ||
          Object.values(LAND_SALE_EVENTS_OLD)
            .map((event) => event.topic)
            .includes(topic)
        ) {
          landSaleEvents.push(item.event);
        }
      }
    }
  }

  await saveEntities(ctx, landSaleEvents, xcRmrkTransferValues);
}

const saveEntities = async (
  ctx: Context,
  landSaleEvents: EvmLogEvent[],
  xcRmrkTransferEvents: Record<string, BigNumber>,
) => {
  let landSales: LandSale[] = [];
  let plotEntities: Plot[] = [];
  let plotOffers: PlotOffer[] = [];
  const offersToRemove: PlotOffer[] = [];

  for (const landSaleEvent of landSaleEvents) {
    const topic = landSaleEvent.args.topics[0];

    const tokenTransferValue = xcRmrkTransferEvents[landSaleEvent.evmTxHash];

    const primarySalesEventMatch = [
      LAND_SALE_EVENTS.primarySale,
      LAND_SALE_EVENTS_OLD.primarySale,
    ].find((primarySaleTopics) => primarySaleTopics.topic === topic);
    if (primarySalesEventMatch) {
      const primarySalesEvent = primarySalesEventMatch.decode(landSaleEvent.args);
      const primarySales = await handlePrimarySaleEvents(
        ctx,
        primarySalesEvent,
        landSaleEvent,
        tokenTransferValue || BigNumber.from(0),
      );
      landSales = landSales.concat(primarySales.landSales);
      plotEntities = plotEntities.concat(primarySales.plotEntities);
    }

    const secondarySaleEventMatch = [
      LAND_SALE_EVENTS.secondarySale,
      LAND_SALE_EVENTS_OLD.secondarySale,
    ].find((secondarySaleTopics) => secondarySaleTopics.topic === topic);
    if (secondarySaleEventMatch) {
      const secondarySalesEvent = secondarySaleEventMatch.decode(landSaleEvent.args);
      const secondarySales = await handleSecondarySaleEvents(
        ctx,
        secondarySalesEvent,
        landSaleEvent,
        plotEntities,
      );
      plotEntities = secondarySales.plotEntities;
      landSales = landSales.concat(secondarySales.landSales);
    }

    const plotTransferEventMatch = [
      LAND_SALE_EVENTS.plotTransfer,
      LAND_SALE_EVENTS_OLD.plotTransfer,
    ].find((plotTransferTopics) => plotTransferTopics.topic === topic);
    if (plotTransferEventMatch) {
      const plotTransferEvent = plotTransferEventMatch.decode(landSaleEvent.args);
      plotEntities = await handleLandTransferEvents(
        ctx,
        plotTransferEvent,
        landSaleEvent,
        plotEntities,
      );
    }

    const offerMadeEventMatch = [LAND_SALE_EVENTS.offerMade, LAND_SALE_EVENTS_OLD.offerMade].find(
      (offerMadeTopics) => offerMadeTopics.topic === topic,
    );
    if (offerMadeEventMatch) {
      const offerMadeEvent = offerMadeEventMatch.decode(landSaleEvent.args);
      const offers = await handleOfferMadeEvents(ctx, offerMadeEvent, landSaleEvent, plotEntities);
      plotEntities = offers.plotEntities;
      plotOffers = plotOffers.concat(offers.offers);
    }

    const offerCancelledEventMatch = [
      LAND_SALE_EVENTS.offerCancelled,
      LAND_SALE_EVENTS_OLD.offerCancelled,
    ].find((offerCancelledTopics) => offerCancelledTopics.topic === topic);
    if (offerCancelledEventMatch) {
      const offerCancelledEvent = offerCancelledEventMatch.decode(landSaleEvent.args);
      const offerToRemove = await handleOfferCancelledEvents(ctx, offerCancelledEvent);
      if (offerToRemove) {
        offersToRemove.push(offerToRemove);
      }
      const offerToRemoveIndex = plotOffers.findIndex((offer) => offer.id === offerToRemove.id);

      if (offerToRemoveIndex > -1) {
        plotOffers.splice(offerToRemoveIndex, 1);
      }
    }

    const plotListedEventMatch = [
      LAND_SALE_EVENTS.plotListedForSale,
      LAND_SALE_EVENTS_OLD.plotListedForSale,
    ].find((plotListedTopics) => plotListedTopics.topic === topic);
    if (plotListedEventMatch) {
      const plotListedEvent = plotListedEventMatch.decode(landSaleEvent.args);
      plotEntities = await handlePlotListedEvents(
        ctx,
        plotListedEvent,
        landSaleEvent,
        plotEntities,
      );
    }

    const plotDeListedEventMatch = [
      LAND_SALE_EVENTS.plotDeListedForSale,
      LAND_SALE_EVENTS_OLD.plotDeListedForSale,
    ].find((plotDeListedTopics) => plotDeListedTopics.topic === topic);
    if (plotDeListedEventMatch) {
      const plotDeListedEvent = plotDeListedEventMatch.decode(landSaleEvent.args);
      plotEntities = await handlePlotListedEvents(
        ctx,
        plotDeListedEvent,
        landSaleEvent,
        plotEntities,
      );
    }

    const plotPriceChangedEventMatch = [
      LAND_SALE_EVENTS.plotPriceChanged,
      LAND_SALE_EVENTS_OLD.plotPriceChanged,
    ].find((plotPriceChangedTopics) => plotPriceChangedTopics.topic === topic);
    if (plotPriceChangedEventMatch) {
      const plotPriceChangedEvent = plotPriceChangedEventMatch.decode(landSaleEvent.args);
      plotEntities = await handlePlotPriceChangedEvents(
        ctx,
        plotPriceChangedEvent,
        landSaleEvent,
        plotEntities,
      );
    }
  }

  await ctx.store.save(plotEntities);
  await ctx.store.save(landSales);
  await ctx.store.save(plotOffers);
  await ctx.store.remove(offersToRemove);
};

const handlePlotListedEvents = async (
  ctx: Context,
  plotListedEvent: PlotListed0Event | PlotDelisted0Event,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<Plot[]> => {
  const { seller, plotId } = plotListedEvent;

  const { store } = ctx;
  const plotIdStr = plotId.toString();
  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);

  // Remove offers on delist
  if (!(plotListedEvent as PlotListed0Event)?.price) {
    const offers = await ctx.store.find(PlotOffer, { where: { parentPlotId: plotIdStr } });
    await ctx.store.remove(offers);
  }

  const plot: Plot =
    existingPlotIndex > -1
      ? plotEntities[existingPlotIndex]
      : (await store.get(Plot, plotIdStr)) ||
        new Plot({
          id: plotIdStr,
        });

  plot.owner = seller;
  plot.price = (plotListedEvent as PlotListed0Event)?.price?.toBigInt() || BigInt(0);

  if (existingPlotIndex > -1) {
    plotEntities[existingPlotIndex] = plot;
  } else {
    plotEntities.push(plot);
  }

  return plotEntities;
};

const handlePrimarySaleEvents = async (
  ctx: Context,
  primarySalesEvent: PlotsBought0Event,
  event: EvmLogEvent,
  tokenTransferValue: BigNumber,
): Promise<{ landSales: LandSale[]; plotEntities: Plot[] }> => {
  const { boughtWithCredits, buyer, referrer, plotIds } = primarySalesEvent;

  const { store } = ctx;
  const landSales: LandSale[] = [];
  const plotEntities: Plot[] = [];

  for (const plotId of plotIds) {
    const plotIdStr = plotId.toString();
    let plot = await store.get(Plot, plotIdStr);

    if (!plot) {
      plot = new Plot({
        id: plotIdStr,
        owner: buyer,
        price: BigInt(0),
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
      price: boughtWithCredits ? BigInt(0) : tokenTransferValue.toBigInt(),
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
  secondarySalesEvent: PlotPurchased0Event,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<{ landSales: LandSale[]; plotEntities: Plot[] }> => {
  const { seller, buyer, price, plotId } = secondarySalesEvent;

  const { store } = ctx;
  const landSales: LandSale[] = [];

  const plotIdStr = plotId.toString();
  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);

  const plot: Plot =
    existingPlotIndex > -1
      ? plotEntities[existingPlotIndex]
      : (await store.get(Plot, plotIdStr)) ||
        new Plot({
          id: plotIdStr,
        });
  plot.owner = buyer;
  plot.price = BigInt(0);

  const sale = new LandSale({
    id: `${plotIdStr}-${event.evmTxHash}`,
    plot,
    buyer,
    price: price.toBigInt(),
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
  offerMadeEvent: OfferMade0Event,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<{ offers: PlotOffer[]; plotEntities: Plot[] }> => {
  const { plotId, price, buyer } = offerMadeEvent;

  const { store } = ctx;
  const offers: PlotOffer[] = [];

  const plotIdStr = plotId.toString();
  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);
  const plot: Plot =
    existingPlotIndex > -1
      ? plotEntities[existingPlotIndex]
      : (await store.get(Plot, plotIdStr)) ||
        new Plot({
          id: plotIdStr,
          price: BigInt(0),
          owner: AddressZero,
        });

  const offer = new PlotOffer({
    id: `${plotIdStr}-${buyer}-${price.toString()}`,
    price: price.toBigInt(),
    plot,
    buyer,
    txnHash: event.evmTxHash,
    createdAt: new Date(),
    parentPlotId: plotIdStr,
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
  offerCancelledEvent: OfferCancelled0Event,
): Promise<PlotOffer> => {
  const { plotId, price, buyer } = offerCancelledEvent;
  const plotIdStr = plotId.toString();
  const offerId = `${plotIdStr}-${buyer}-${price.toString()}`;
  const existingOffer = await ctx.store.get(PlotOffer, offerId);
  return (
    existingOffer ||
    new PlotOffer({
      id: offerId,
      price: BigInt(0),
      parentPlotId: plotIdStr,
    })
  );
};

const handlePlotPriceChangedEvents = async (
  ctx: Context,
  plotPriceChangedEvent: PlotPriceChanged0Event,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<Plot[]> => {
  const { plotId, newPrice } = plotPriceChangedEvent;
  const plotIdStr = plotId.toString();

  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);

  const plot: Plot =
    existingPlotIndex > -1
      ? plotEntities[existingPlotIndex]
      : (await ctx.store.get(Plot, plotIdStr)) ||
        new Plot({
          id: plotIdStr,
          price: newPrice.toBigInt(),
        });

  plot.price = newPrice.toBigInt();

  if (existingPlotIndex > -1) {
    plotEntities[existingPlotIndex] = plot;
  } else {
    plotEntities.push(plot);
  }

  return plotEntities;
};

const handleLandTransferEvents = async (
  ctx: Context,
  plotTransferEvent: PlotTransferred0Event,
  event: EvmLogEvent,
  plotEntities: Plot[],
): Promise<Plot[]> => {
  const { plotIds: plotId, newOwner } = plotTransferEvent;

  const { store } = ctx;

  const plotIdStr = plotId.toString();
  const existingPlotIndex = plotEntities.findIndex((plotEntity) => plotEntity.id === plotIdStr);

  let plot =
    existingPlotIndex > -1 ? plotEntities[existingPlotIndex] : await store.get(Plot, plotIdStr);
  if (!plot) {
    plot = new Plot({
      id: plotIdStr,
      owner: newOwner,
      price: BigInt(0),
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

processor.run(database, processBatches);
