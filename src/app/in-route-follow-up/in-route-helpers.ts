import { IdEntity, StringColumn, Context, EntityClass, NumberColumn } from "@remult/core";
import { Roles } from "../auth/roles";
import { getSettings } from "../manage/ApplicationSettings";
import { SqlBuilder, DateTimeColumn, changeDate } from "../model-shared/types";
import { getLang } from "../sites/sites";
import { Helpers, HelperIdReadonly, HelperId } from "../helpers/helpers";
import { ActiveFamilyDeliveries, MessageStatus, MessageStatusColumn } from "../families/FamilyDeliveries";
import { DeliveryStatus } from "../families/DeliveryStatus";

@EntityClass
export class InRouteHelpers extends IdEntity {
    name = new StringColumn(getLang(this.context).volunteerName);
    messageStatus = new MessageStatusColumn();
    minDeliveryCreateDate = new DateTimeColumn("תאריך הקצאה");
    deliveriesInProgress = new NumberColumn(getLang(this.context).delveriesInProgress);
    maxAssignDate = new DateTimeColumn("תאריך שיוך אחרון");
    constructor(private context: Context) {
        super({
            name: 'in-route-helpers',
            allowApiRead: Roles.admin,
            dbName: () => {
                let sql = new SqlBuilder();
                let f = context.for(ActiveFamilyDeliveries).create();
                let h = context.for(Helpers).create();
                let helperFamilies = (where: () => any[]) => {
                    return {
                        from: f,
                        where: () => [f.distributionCenter.isAllowedForUser(), sql.eq(f.courier, h.id), ...where()]
                    }
                }
                return sql.build('(select *,',
                    sql.case([{
                        when: [sql.gt(h.lastSignInDate, this.maxAssignDate)],
                        then: MessageStatus.opened.id
                    }, {
                        when: [sql.gt(h.smsDate, this.maxAssignDate)],
                        then: MessageStatus.notOpened.id
                    }
                    ], MessageStatus.notSent.id), ' ', this.messageStatus
                    , ' from (', sql.query({
                        select: () => [h.id, h.name, h.lastSignInDate, h.smsDate,
                        sql.countDistinctInnerSelect(f.family, helperFamilies(() => [f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery)]), this.deliveriesInProgress)
                            , sql.minInnerSelect(f.createDate, helperFamilies(() => [f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery)]), this.minDeliveryCreateDate)
                            , sql.maxInnerSelect(f.courierAssingTime, helperFamilies(() => [f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery)]), this.maxAssignDate)
                        ],

                        from: h,
                        where: () => [h.archive.isEqualTo(false), sql.build(h.id, ' in (', sql.query({
                            select: () => [f.courier],
                            from: f,
                            where: () => [f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery)]
                        }), ')')]
                    }), ') result ) result');
            }
        });
    }
}

@EntityClass
export class HelperCommunicationHistory extends IdEntity {
    createDate = new changeDate({ caption: getLang(this.context).createDate });
    createUser = new HelperIdReadonly(this.context, { caption: getLang(this.context).createUser });
    volunteer = new HelperId(this.context, { caption: getLang(this.context).volunteer });
    comment = new StringColumn("הערה");
    constructor(private context: Context) {
        super({
            name: 'HelperCommunicationHistory',
            allowApiCRUD: Roles.admin,
            allowApiRead: Roles.admin,
            saving: () => {
                if (this.isNew()) {
                    this.createDate.value = new Date();
                    this.createUser.value = this.context.user.id;
                }
            }

        })
    }

}