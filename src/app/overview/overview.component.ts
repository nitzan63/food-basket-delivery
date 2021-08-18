import { Component, OnInit } from '@angular/core';
import { Remult, BackendMethod, Entity, SqlDatabase, ProgressListener } from 'remult';
import { Roles } from '../auth/roles';
import { Sites, validSchemaName } from '../sites/sites';
import { ApplicationSettings } from '../manage/ApplicationSettings';

import { SqlBuilder, SqlFor } from "../model-shared/SqlBuilder";
import { ActiveFamilyDeliveries } from '../families/FamilyDeliveries';
import { FamilyDeliveries } from '../families/FamilyDeliveries';
import { InputAreaComponent } from '../select-popup/input-area/input-area.component';
import { DialogService, extractError } from '../select-popup/dialog';
import { Helpers } from '../helpers/helpers';
import { SiteOverviewComponent } from '../site-overview/site-overview.component';
import { SitesEntity } from '../sites/sites.entity';
import { InputField, openDialog } from '@remult/angular';
import { DeliveryStatus } from '../families/DeliveryStatus';
import { InitContext } from '../helpers/init-context';
import { Phone } from '../model-shared/phone';

@Component({
  selector: 'app-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss']
})
export class OverviewComponent implements OnInit {

  constructor(private remult: Remult, private dialog: DialogService) { }
  overview: overviewResult;
  sortBy: string;
  async ngOnInit() {
    this.overview = await OverviewComponent.getOverview();
    for (const s of this.overview.sites) {
      s.lastSignIn = new Date(s.lastSignIn);
    }
    this.overview.sites.sort((a, b) => b.lastSignIn?.valueOf() - a.lastSignIn?.valueOf());

  }
  searchString = '';
  showSite(s: siteItem) {
    return !this.searchString || s.name.includes(this.searchString);
  }
  showSiteInfo(s: siteItem) {
    openDialog(SiteOverviewComponent, x => x.args = { site: s, statistics: this.overview.statistics });
  }
  doSort(s: dateRange) {
    this.sortBy = s.caption;
    this.overview.sites.sort((a, b) => b.stats[s.caption] - a.stats[s.caption]);
  }
  @BackendMethod({ allowed: Roles.overview, queue: true })
  static async getOverview(remult?: Remult, progress?: ProgressListener) {
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

    var builder = new SqlBuilder(remult);
    let f = SqlFor( remult.repo(ActiveFamilyDeliveries));
    let fd = SqlFor( remult.repo(FamilyDeliveries));



    let soFar = 0;
    for (const org of Sites.schemas) {
      progress.progress(++soFar / Sites.schemas.length);
      let dp = Sites.getDataProviderForOrg(org);

      var as = await SqlFor( remult.repo(ApplicationSettings));
      var h = await SqlFor( remult.repo(Helpers));

      let cols: any[] = [as.organisationName, as.logoUrl, builder.build("(", builder.query({
        from: h,
        select: () => [builder.max(h.lastSignInDate)],
        where: () => [h.admin.isEqualTo(true)]
      }), ")")];

      for (const dateRange of result.statistics) {
        let key = 'a' + cols.length;
        if (dateRange.caption == inEvent) {
          cols.push(builder.countInnerSelect({ from: f }, key));


        } else if (dateRange.caption == onTheWay) {
          cols.push(builder.countInnerSelect({ from: f, where: () => [FamilyDeliveries.onTheWayFilter()] }, key));
        }
        else
          cols.push(builder.build('(select count(*) from ', fd, ' where ', builder.and(fd.deliveryStatusDate.isGreaterOrEqualTo(dateRange.from).and(fd.deliveryStatusDate.isLessThan(dateRange.to).and(DeliveryStatus.isAResultStatus(fd.deliverStatus)))), ') ', key));

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
  async createNewSchema() {
    let id = new InputField<string>({ caption: 'id' });
    let name = new InputField<string>({ caption: 'שם הארגון' });
    let address = new InputField<string>({ caption: 'כתובת מרכז חלוקה' });
    let manager = new InputField<string>({ caption: 'שם מנהל' });
    let phone = new InputField<string>({ caption: 'טלפון', inputType: 'tel' });
    openDialog(InputAreaComponent, x => x.args = {
      title: 'הוספת סביבה חדשה',
      settings: {
        fields: () => [id, name, address, manager, phone]
      },
      validate: async () => {
        let x = validSchemaName(id.value);
        if (x != id.value) {
          if (await this.dialog.YesNoPromise('המזהה כלל תוים לא חוקיים שהוסרו, האם להמשיך עם המזהה "' + x + '"')) {
            id.value = x;
          } else
            throw "שם לא חוקי";
        }
        id.value = validSchemaName(id.value);
        let r = await OverviewComponent.validateNewSchema(id.value);
        if (r) {
          throw r;
        }
      },
      cancel: () => { },
      ok: async () => {
        try {
          let r = await OverviewComponent.createSchema(id.value, name.value, address.value, manager.value, phone.value);
          if (!r.ok)
            throw r.errorText;
          window.open(location.href = '/' + id.value, '_blank');
          this.ngOnInit();
        }
        catch (err) {
          this.dialog.Error(err);
        }
      }
    });
  }
  @BackendMethod({ allowed: Roles.overview })
  static async createSchema(id: string, name: string, address: string, manager: string, phone: string, remult?: Remult): Promise<{
    ok: boolean,
    errorText: string
  }> {
    let r = await OverviewComponent.validateNewSchema(id, remult);
    if (r) {
      return {
        ok: false,
        errorText: r
      }
    }
    try {
      if (!name || name.length == 0)
        name = id;
      let oh = await  remult.repo(Helpers).findId(remult.user.id);
      let db = await OverviewComponent.createDbSchema(id);
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

      let s =  remult.repo(SitesEntity).create();
      s.id = id;
      await s.save();



      await OverviewComponent.createSchemaApi(id);
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
    let x = await  remult.repo(SitesEntity).findId(id);
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
interface overviewResult {
  statistics: dateRange[];
  sites: siteItem[];
}

export interface dateRange {
  caption: string;
  value: number;
  from: Date;
  to: Date;
}
