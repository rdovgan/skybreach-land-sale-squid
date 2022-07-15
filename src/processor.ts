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
import { PlotListed0Event } from './abi/landSales';
import * as landSalesOldAbi from './abi/landSaleOld';
import * as xcRMRKAbi from './abi/xcRMRK';

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

const getPrimarySaleEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.primarySale, LAND_SALE_EVENTS_OLD.primarySale].find(
    (primarySaleTopics) => primarySaleTopics.topic === topic,
  );
};

const getSecondarySaleEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.secondarySale, LAND_SALE_EVENTS_OLD.secondarySale].find(
    (secondarySaleTopics) => secondarySaleTopics.topic === topic,
  );
};

const getPlotTransferEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.plotTransfer, LAND_SALE_EVENTS_OLD.plotTransfer].find(
    (plotTransferTopics) => plotTransferTopics.topic === topic,
  );
};

const getOfferMadeEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.offerMade, LAND_SALE_EVENTS_OLD.offerMade].find(
    (offerMadeTopics) => offerMadeTopics.topic === topic,
  );
};

const getOfferCancelledEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.offerCancelled, LAND_SALE_EVENTS_OLD.offerCancelled].find(
    (offerCancelledTopics) => offerCancelledTopics.topic === topic,
  );
};

const getPlotListedEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.plotListedForSale, LAND_SALE_EVENTS_OLD.plotListedForSale].find(
    (plotListedTopics) => plotListedTopics.topic === topic,
  );
};

const getPlotDelistedEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.plotDeListedForSale, LAND_SALE_EVENTS_OLD.plotDeListedForSale].find(
    (plotDeListedTopics) => plotDeListedTopics.topic === topic,
  );
};

const getPriceChangeEvent = (topic: string) => {
  return [LAND_SALE_EVENTS.plotPriceChanged, LAND_SALE_EVENTS_OLD.plotPriceChanged].find(
    (plotPriceChangedTopics) => plotPriceChangedTopics.topic === topic,
  );
};

const saveEntities = async (
  ctx: Context,
  landSaleEvents: EvmLogEvent[],
  xcRmrkTransferEvents: Record<string, BigNumber>,
) => {
  for (const landSaleEvent of landSaleEvents) {
    const tokenTransferValue = xcRmrkTransferEvents[landSaleEvent.evmTxHash];
    await handlePrimarySaleEvents(ctx, landSaleEvent, tokenTransferValue || BigNumber.from(0));
    await handleSecondarySaleEvents(ctx, landSaleEvent);
    await handleLandTransferEvents(ctx, landSaleEvent);
    await handleOfferMadeEvents(ctx, landSaleEvent);
    await handleOfferCancelledEvents(ctx, landSaleEvent);
    await handlePlotListedEvents(ctx, landSaleEvent);
    await handlePlotPriceChangedEvents(ctx, landSaleEvent);
  }
};

const handlePlotListedEvents = async (ctx: Context, event: EvmLogEvent) => {
  const topic = event.args.topics[0];
  const plotListedEventMatch = getPlotListedEvent(topic);
  const plotDelistedEventMatch = getPlotDelistedEvent(topic);

  const listedDelistedEventMatch = plotDelistedEventMatch || plotListedEventMatch;

  if (listedDelistedEventMatch) {
    const plotListedEvent = listedDelistedEventMatch.decode(event.args);
    const { seller, plotId } = plotListedEvent;

    const { store } = ctx;
    const plotIdStr = plotId.toString();

    // Remove offers on delist
    if (plotDelistedEventMatch) {
      const offers = await ctx.store.find(PlotOffer, { where: { parentPlotId: plotIdStr } });
      await ctx.store.remove(offers);
    }

    const plot: Plot =
      (await store.get(Plot, plotIdStr)) ||
      new Plot({
        id: plotIdStr,
      });

    plot.owner = seller;
    plot.price = (plotListedEvent as PlotListed0Event)?.price?.toBigInt() || BigInt(0);

    await ctx.store.save(plot);
  }
};

const handlePrimarySaleEvents = async (
  ctx: Context,
  event: EvmLogEvent,
  tokenTransferValue: BigNumber,
) => {
  const topic = event.args.topics[0];
  const primarySalesEventMatch = getPrimarySaleEvent(topic);

  if (primarySalesEventMatch) {
    const primarySalesEvent = primarySalesEventMatch.decode(event.args);
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

    await ctx.store.save(plotEntities);
    await ctx.store.save(landSales);
  }
};

const handleSecondarySaleEvents = async (ctx: Context, event: EvmLogEvent) => {
  const topic = event.args.topics[0];
  const secondarySaleEventMatch = getSecondarySaleEvent(topic);

  if (secondarySaleEventMatch) {
    const secondarySalesEvent = secondarySaleEventMatch.decode(event.args);
    const { seller, buyer, price, plotId } = secondarySalesEvent;
    const { store } = ctx;

    const plotIdStr = plotId.toString();

    const plot: Plot =
      (await store.get(Plot, plotIdStr)) ||
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

    // Remove offers on delist
    const offers = await ctx.store.find(PlotOffer, { where: { parentPlotId: plotIdStr } });
    if (offers.length > 0) {
      await ctx.store.remove(offers);
    }

    await ctx.store.save(plot);
    await ctx.store.save(sale);
  }
};

const handleOfferMadeEvents = async (ctx: Context, event: EvmLogEvent) => {
  const topic = event.args.topics[0];
  const offerMadeEventMatch = getOfferMadeEvent(topic);

  if (offerMadeEventMatch) {
    const offerMadeEvent = offerMadeEventMatch.decode(event.args);
    const { plotId, price, buyer } = offerMadeEvent;

    const { store } = ctx;

    const plotIdStr = plotId.toString();
    const plot: Plot =
      (await store.get(Plot, plotIdStr)) ||
      new Plot({
        id: plotIdStr,
        price: BigInt(0),
        owner: AddressZero,
      });

    let offerId = `${plotIdStr}-${buyer}-${price.toString()}`;

    const existingOffer = await ctx.store.find(PlotOffer, {
      where: { buyer, price: price.toBigInt(), parentPlotId: plotIdStr },
    });

    offerId = `${offerId}-${existingOffer.length + 1}`;

    const offer = new PlotOffer({
      id: offerId,
      price: price.toBigInt(),
      plot,
      buyer,
      txnHash: event.evmTxHash,
      createdAt: new Date(),
      parentPlotId: plotIdStr,
    });

    await ctx.store.save(plot);
    await ctx.store.save(offer);
  }
};

const handleOfferCancelledEvents = async (ctx: Context, event: EvmLogEvent) => {
  const topic = event.args.topics[0];
  const offerCancelledEventMatch = getOfferCancelledEvent(topic);

  if (offerCancelledEventMatch) {
    const offerCancelledEvent = offerCancelledEventMatch.decode(event.args);
    const { plotId, price, buyer } = offerCancelledEvent;
    const plotIdStr = plotId.toString();
    const existingOffer = await ctx.store.find(PlotOffer, {
      where: { buyer, price: price.toBigInt(), parentPlotId: plotIdStr },
    });

    const offerToRemove = existingOffer?.[existingOffer.length - 1];

    if (offerToRemove) {
      await ctx.store.remove(offerToRemove);
    }
  }
};

const handlePlotPriceChangedEvents = async (ctx: Context, event: EvmLogEvent) => {
  const topic = event.args.topics[0];
  const plotPriceChangedEventMatch = getPriceChangeEvent(topic);

  if (plotPriceChangedEventMatch) {
    const plotPriceChangedEvent = plotPriceChangedEventMatch.decode(event.args);
    const { plotId, newPrice } = plotPriceChangedEvent;
    const plotIdStr = plotId.toString();

    const plot: Plot =
      (await ctx.store.get(Plot, plotIdStr)) ||
      new Plot({
        id: plotIdStr,
        price: newPrice.toBigInt(),
      });

    plot.price = newPrice.toBigInt();

    await ctx.store.save(plot);
  }
};

const handleLandTransferEvents = async (ctx: Context, event: EvmLogEvent) => {
  const topic = event.args.topics[0];
  const plotTransferEventMatch = getPlotTransferEvent(topic);

  if (plotTransferEventMatch) {
    const plotTransferEvent = plotTransferEventMatch.decode(event.args);
    const { plotIds: plotId, newOwner } = plotTransferEvent;
    const { store } = ctx;

    const plotIdStr = plotId.toString();

    let plot = await store.get(Plot, plotIdStr);
    if (!plot) {
      plot = new Plot({
        id: plotIdStr,
        owner: newOwner,
        price: BigInt(0),
      });
    } else {
      plot.owner = newOwner;
    }

    await ctx.store.save(plot);
  }
};

processor.run(database, processBatches);
