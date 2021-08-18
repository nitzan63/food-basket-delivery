
import { Filter, AndFilter, Remult, BackendMethod, Entity, SqlDatabase, EntityBase, FilterFactories, ExcludeEntityFromApi } from "remult";
import { Roles } from "../auth/roles";
import { YesNo } from "../families/YesNo";
import { BasketType } from "../families/BasketType";
import { FamilyDeliveries, ActiveFamilyDeliveries, MessageStatus } from "../families/FamilyDeliveries";

import { SqlBuilder, SqlFor } from "../model-shared/SqlBuilder";
import { DeliveryStatus } from "../families/DeliveryStatus";
import { DistributionCenters } from "../manage/distribution-centers";

import { colors } from "../families/stats-action";
import { getLang } from '../sites/sites';
import { Field } from '../translate';


export class FamilyDeliveryStats {
    constructor(private remult: Remult) { }

    ready = new FamilyDeliveresStatistics(getLang(this.remult).unAsigned,
        f => FamilyDeliveries.readyFilter().and(
            f.special.isDifferentFrom(YesNo.Yes))
        , colors.yellow);
    selfPickup = new FamilyDeliveresStatistics(getLang(this.remult).selfPickup, f => f.deliverStatus.isEqualTo(DeliveryStatus.SelfPickup), colors.orange);
    special = new FamilyDeliveresStatistics(getLang(this.remult).specialUnasigned,
        f => FamilyDeliveries.readyFilter().and(
            f.special.isEqualTo(YesNo.Yes))
        , colors.orange);

    onTheWay = new FamilyDeliveresStatistics(getLang(this.remult).onTheWay, f => FamilyDeliveries.onTheWayFilter(), colors.blue);
    delivered = new FamilyDeliveresStatistics(getLang(this.remult).delveriesSuccesfull, f => DeliveryStatus.isSuccess(f.deliverStatus), colors.green);
    problem = new FamilyDeliveresStatistics(getLang(this.remult).problems, f => DeliveryStatus.isProblem(f.deliverStatus), colors.red);
    frozen = new FamilyDeliveresStatistics(getLang(this.remult).frozens, f => f.deliverStatus.isEqualTo(DeliveryStatus.Frozen), colors.gray);
    needWork = new FamilyDeliveresStatistics(getLang(this.remult).requireFollowUp, f => f.needsWork.isEqualTo(true), colors.yellow);


    async getData(distCenter: DistributionCenters) {
        let r = await FamilyDeliveryStats.getFamilyDeliveryStatsFromServer(distCenter);
        for (let s in this) {
            let x: any = this[s];
            if (x instanceof FamilyDeliveresStatistics) {
                x.loadFrom(r.data);
            }
        }
        await Promise.all(r.baskets.map(async b => {
            b.basket = await this. remult.repo(BasketType).findId(b.id);
        }))
        return r;
    }
    @BackendMethod({ allowed: Roles.distCenterAdmin })
    static async getFamilyDeliveryStatsFromServer(distCenter: DistributionCenters, remult?: Remult, db?: SqlDatabase) {
        let result = {
            data: {}, baskets: [] as {
                id: string,
                basket: BasketType,
                name: string,
                boxes: number,
                boxes2: number,
                unassignedDeliveries: number,
                inEventDeliveries: number,
                successDeliveries: number,
                smsNotSent: number,

                selfPickup: number,
            }[], cities: []
        };
        let stats = new FamilyDeliveryStats(remult);
        let pendingStats = [];
        for (let s in stats) {
            let x = stats[s];
            if (x instanceof FamilyDeliveresStatistics) {
                pendingStats.push(x.saveTo(distCenter, result.data, remult));
            }
        }

        let f = SqlFor( remult.repo(ActiveFamilyDeliveries));

        let sql = new SqlBuilder(remult);
        sql.addEntity(f, "FamilyDeliveries")
        let baskets = await db.execute(await sql.build(sql.query({
            select: () => [f.basketType,
            sql.build('sum (', sql.case([{ when: [FamilyDeliveries.readyAndSelfPickup(f)], then: f.quantity }], 0), ') a'),
            sql.build('sum (', f.quantity, ') b'),
            sql.build('sum (', sql.case([{ when: [DeliveryStatus.isSuccess(f.deliverStatus)], then: f.quantity }], 0), ') c'),
            sql.build('sum (', sql.case([{ when: [f.deliverStatus.isEqualTo(DeliveryStatus.SelfPickup)], then: f.quantity }], 0), ') d'),
            sql.build('sum (', sql.case([{ when: [FamilyDeliveries.onTheWayFilter().and(f.messageStatus.isEqualTo(MessageStatus.notSent))], then: f.quantity }], 0), ') e')

            ],
            from: f,
            where: () => [remult.filterDistCenter(f.distributionCenter, distCenter)]
        }), ' group by ', f.basketType));
        for (const r of baskets.rows) {
            let basketId = r[baskets.getColumnKeyInResultForIndexInSelect(0)];
            let b = await  remult.repo(BasketType).findId(basketId, { createIfNotFound: true });
            result.baskets.push({
                id: basketId,
                name: b.name,
                boxes: b.boxes,
                boxes2: b.boxes2,
                unassignedDeliveries: +r['a'],
                inEventDeliveries: +r['b'],
                successDeliveries: +r['c'],
                selfPickup: +r['d'],
                smsNotSent: +r['e'],
                basket: undefined

            });
        }



        if (distCenter == null)
            pendingStats.push(
                 remult.repo(CitiesStats).find({
                    orderBy: f => f.deliveries.descending()
                }).then(cities => {
                    result.cities = cities.map(x => {
                        return {
                            name: x.city,
                            count: x.deliveries
                        }
                    });
                })
            );
        else
            pendingStats.push(
                 remult.repo(CitiesStatsPerDistCenter).find({
                    orderBy: f => f.families.descending(),
                    where: f => remult.filterDistCenter(f.distributionCenter, distCenter)

                }).then(cities => {
                    result.cities = cities.map(x => {
                        return {
                            name: x.city,
                            count: x.families
                        }
                    });
                })
            );



        await Promise.all(pendingStats);

        return result;
    }
}

export class FamilyDeliveresStatistics {
    constructor(public name: string, public rule: (f: FilterFactories<ActiveFamilyDeliveries>) => Filter, public color?: string, value?: number) {
        this.value = value;
    }

    value = 0;
    async saveTo(distCenter: DistributionCenters, data: any, remult: Remult) {
        try {

            data[this.name] = await  remult.repo(ActiveFamilyDeliveries).count(f => new AndFilter(this.rule(f), remult.filterDistCenter(f.distributionCenter, distCenter))).then(c => this.value = c);
        }
        catch (err) {
            console.error(this.name, err);
        }
    }
    async loadFrom(data: any) {
        this.value = data[this.name];
    }
}
export interface groupStats {
    name: string,
    totalReady: number

}
@ExcludeEntityFromApi()
@Entity<CitiesStats>({
    key: 'citiesStats'
}, (options, remult) =>
    options.dbName = async (self) => {
        let f = SqlFor( remult.repo(ActiveFamilyDeliveries));
        let sql = new SqlBuilder(remult);

        return sql.build('(', (await sql.query({
            select: () => [f.city, sql.columnWithAlias("count(*)", self.deliveries)],
            from: f,
            where: () => [f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery),
            remult.filterCenterAllowedForUser(f.distributionCenter),
            sql.eq(f.courier, '\'\'')]
        })).replace('as result', 'as '), ' group by ', f.city, ') as result')
    }
)
export class CitiesStats {
    @Field()
    city: string;
    @Field()
    deliveries: number;
}
@Entity<CitiesStatsPerDistCenter>({
    allowApiRead: false,
    key: 'citiesStatsPerDistCenter'
}, (options, remult) =>
    options.dbName = async (self) => {
        let f = SqlFor( remult.repo(ActiveFamilyDeliveries));
        let sql = new SqlBuilder(remult);

        return sql.build('(', (await sql.query({
            select: () => [f.city, f.distributionCenter, sql.columnWithAlias("count(*)", self.families)],
            from: f,
            where: () => [f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery),
            remult.filterCenterAllowedForUser(f.distributionCenter),
            sql.eq(f.courier, '\'\'')]
        })).replace('as result', 'as '), ' group by ', [f.city, f.distributionCenter], ') as result')
    })

export class CitiesStatsPerDistCenter extends EntityBase {
    @Field()
    city: string;
    @Field()
    distributionCenter: DistributionCenters;
    @Field()
    families: number;

}