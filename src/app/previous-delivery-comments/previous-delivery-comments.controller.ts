import { BackendMethod, Remult } from 'remult';
import { DateValueConverter } from 'remult/valueConverters';
import { Roles } from '../auth/roles';
import { FamilyDeliveries } from '../families/FamilyDeliveries';
import { getSettings } from '../manage/ApplicationSettings';


export class PreviousDeliveryController {
    @BackendMethod({ allowed: r => getSettings(r).allowVolunteerToSeePreviousActivities })
    static async getHistory(family: string, remult?: Remult) {
        return (await remult.repo(FamilyDeliveries).find({
            where: {
                family: [family],
                courier: remult.isAllowed(Roles.admin) ? undefined : await remult.getCurrentUser()
            },
            orderBy: {
                deliveryStatusDate: "desc"
            }
        })).map(({ deliveryStatusDate, courierComments }) => ({
            date: DateValueConverter.toJson(deliveryStatusDate),
            courierComments
        }))
    }
}