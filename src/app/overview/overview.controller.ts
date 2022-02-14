import { Remult, BackendMethod, Entity, SqlDatabase, ProgressListener } from 'remult';
import { Roles } from '../auth/roles';
import { Sites, validSchemaName } from '../sites/sites';
import { ApplicationSettings } from '../manage/ApplicationSettings';

import { SqlBuilder, SqlFor } from "../model-shared/SqlBuilder";
import { ActiveFamilyDeliveries } from '../families/FamilyDeliveries';
import { FamilyDeliveries } from '../families/FamilyDeliveries';
import { extractError } from "../select-popup/extractError";
import { Helpers } from '../helpers/helpers';
import { SitesEntity } from '../sites/sites.entity';
import { DeliveryStatus } from '../families/DeliveryStatus';
import { InitContext } from '../helpers/init-context';
import { Phone } from '../model-shared/phone';
export class OverviewController {
    @BackendMethod({ allowed: Roles.overview, queue: true })
    static async getOverview(full: boolean, remult?: Remult, progress?: ProgressListener) {
        let today = new Date();
        let onTheWay = "בדרך";
        let inEvent = "באירוע";
        let result: overviewResult = {
            statistics: [
                {
                    caption: 'היום',
                    value: 0,
                    from: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
                    to: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
                },
                {
                    caption: 'אתמול',
                    value: 0,
                    from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1),
                    to: new Date(today.getFullYear(), today.getMonth(), today.getDate())
                },
                {
                    caption: 'השבוע',
                    value: 0,
                    from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay()),
                    to: new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() + 7)
                },
                {
                    caption: 'השבוע שעבר',
                    value: 0,
                    from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - 7),
                    to: new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
                },
                {
                    caption: 'החודש',
                    value: 0,
                    from: new Date(today.getFullYear(), today.getMonth(), 1),
                    to: new Date(today.getFullYear(), today.getMonth() + 1, 1)
                },
                {
                    caption: 'חודש שעבר',
                    value: 0,
                    from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
                    to: new Date(today.getFullYear(), today.getMonth(), 1)
                },
                {
                    caption: 'השנה',
                    value: 0,
                    from: new Date(today.getFullYear(), 0, 1),
                    to: new Date(today.getFullYear() + 1, 0, 1)
                }
                ,
                {
                    caption: 'שנה שעברה',
                    value: 0,
                    from: new Date(today.getFullYear() - 1, 0, 1),
                    to: new Date(today.getFullYear(), 0, 1)
                },
                {
                    caption: 'אי פעם',
                    value: 0,
                    from: new Date(2017, 0, 1),
                    to: new Date(today.getFullYear() + 1, 0, 1)
                },
                {
                    caption: inEvent,
                    value: 0,
                    from: undefined,
                    to: undefined
                },
                {
                    caption: onTheWay,
                    value: 0,
                    from: undefined,
                    to: undefined
                }
            ],
            sites: []
        };
        if (!full)
            result.statistics = [];
        else {

        }

        var builder = new SqlBuilder(remult);
        let f = SqlFor(remult.repo(ActiveFamilyDeliveries));
        let fd = SqlFor(remult.repo(FamilyDeliveries));



        let soFar = 0;
        for (const org of Sites.schemas) {
            progress.progress(++soFar / Sites.schemas.length);
            let dp = Sites.getDataProviderForOrg(org);

            var as = await SqlFor(remult.repo(ApplicationSettings));
            var h = await SqlFor(remult.repo(Helpers));

            let cols: any[] = [as.organisationName, as.logoUrl, builder.build("(", builder.query({
                from: h,
                select: () => [builder.max(h.lastSignInDate)],
                where: () => [h.where({ admin: true })]
            }), ")")];

            for (const dateRange of result.statistics) {
                let key = 'a' + cols.length;
                if (dateRange.caption == inEvent) {
                    cols.push(builder.countInnerSelect({ from: f }, key));


                } else if (dateRange.caption == onTheWay) {
                    cols.push(builder.countInnerSelect({ from: f, where: () => [f.where(FamilyDeliveries.onTheWayFilter())] }, key));
                }
                else
                    cols.push(builder.build('(select count(*) from ', fd, ' where ', builder.and(fd.where({ deliveryStatusDate: { ">=": dateRange.from, "<": dateRange.to }, deliverStatus: DeliveryStatus.isAResultStatus() })), ') ', key));

            }

            let z = await builder.query({
                select: () => cols,
                from: as,
            });
            let sql = dp as SqlDatabase;
            let zz = await sql.execute(z);
            let row = zz.rows[0];

            let site: siteItem = {
                name: row[zz.getColumnKeyInResultForIndexInSelect(0)],
                site: org,
                logo: row[zz.getColumnKeyInResultForIndexInSelect(1)],
                stats: {},
                lastSignIn: row[zz.getColumnKeyInResultForIndexInSelect(2)]

            };


            result.sites.push(site);
            let i = 3;
            for (const dateRange of result.statistics) {
                let r = row[zz.getColumnKeyInResultForIndexInSelect(i++)];

                dateRange.value += +r;
                site.stats[dateRange.caption] = r;
            }


        }
        return result;

    }
    
  @BackendMethod({ allowed: Roles.overview })
  static async createSchema(id: string, name: string, address: string, manager: string, phone: string, remult?: Remult): Promise<{
    ok: boolean,
    errorText: string
  }> {
    let r = await OverviewController.validateNewSchema(id, remult);
    if (r) {
      return {
        ok: false,
        errorText: r
      }
    }
    try {
      if (!name || name.length == 0)
        name = id;
      let oh = await remult.repo(Helpers).findId(remult.user.id);
      let db = await OverviewController.createDbSchema(id);
      let otherContext = new Remult();
      otherContext.setDataProvider(db);
      otherContext.setUser(remult.user);
      Sites.setSiteToContext(otherContext, id, remult);
      await InitContext(otherContext);
      {
        let h = await otherContext.repo(Helpers).create();
        h.name = oh.name;
        h.realStoredPassword = oh.realStoredPassword;
        h.phone = oh.phone;
        h.admin = oh.admin;
        await h.save();
      }
      if (manager && phone) {
        let h2 = await otherContext.repo(Helpers).create();
        h2.name = manager;
        h2.phone = new Phone(phone);
        h2.admin = true;
        await h2.save();
      }
      let settings = await ApplicationSettings.getAsync(otherContext);

      settings.organisationName = name;
      settings.address = address;
      await settings.save();

      let s = remult.repo(SitesEntity).create();
      s.id = id;
      await s.save();



      await OverviewController.createSchemaApi(id);
      Sites.addSchema(id);
      return { ok: true, errorText: '' }
    }
    catch (err) {
      return { ok: false, errorText: extractError(err) }
    }
  }
  static createDbSchema = async (id: string): Promise<SqlDatabase> => { return undefined };
  static createSchemaApi = async (id: string) => { };

  @BackendMethod({ allowed: Roles.overview })
  static async validateNewSchema(id: string, remult?: Remult) {
    let x = await remult.repo(SitesEntity).findId(id);
    if (x) {
      return "מזהה כבר קיים";
    }
    let invalidSchemaName = ['admin', 'guest', 'public', 'select'];
    if (invalidSchemaName.includes(id))
      return id + ' הוא מזהה שמור ואסור לשימוש';
    return '';
  }
}

export interface siteItem {
    site: string;
    name: string;
    logo: string;
    lastSignIn: Date;
    stats: {
        [index: string]: number;
    }
}
export interface overviewResult {
    statistics: dateRange[];
    sites: siteItem[];
}

export interface dateRange {
    caption: string;
    value: number;
    from: Date;
    to: Date;
}