import { Context, Entity, IdEntity, ServerFunction } from "@remult/core";
import { BusyService, DataControl, GridSettings, openDialog } from '@remult/angular';
import { Roles } from "../auth/roles";
import { ChangeDateColumn } from "../model-shared/types";
import { getLang } from "../sites/sites";
import { currentUser, HelperId, Helpers, HelpersBase } from "../helpers/helpers";
import { DialogService } from "../select-popup/dialog";
import { GridDialogComponent } from "../grid-dialog/grid-dialog.component";
import { ApplicationSettings } from "../manage/ApplicationSettings";
import { MyGiftsDialogComponent } from "./my-gifts-dialog.component";
import { Field, use } from "../translate";

@Entity<HelperGifts>({
    key: "HelperGifts",
    allowApiRead: context => context.isSignedIn(),
    allowApiUpdate: context => context.isSignedIn(),
    allowApiInsert: Roles.admin,
    apiDataFilter: (self, context) => {
        if (context.isAllowed(Roles.admin))
            return undefined;
        return self.assignedToHelper.isEqualTo(context.get(currentUser));
    },
    saving: (self) => {
        if (self.isNew()) {
            self.dateCreated = new Date();
            self.userCreated = self.context.get(currentUser);
        }
        else {
            if (self.$.giftURL.wasChanged()) {
                self.$.giftURL.error = 'ניתן לקלוט מתנות חדשות .לא ניתן לשנות לינק למתנה';
                return;
            }
            if (self.$.assignedToHelper.wasChanged() && self.wasConsumed != false) {
                self.$.giftURL.error = 'אין לשייך מתנה שכבר מומשה למתנדב אחר';
                return;
            }
            if (self.$.assignedToHelper.wasChanged() && self.assignedToHelper) {
                self.dateGranted = new Date();
                self.assignedByUser = self.context.get(currentUser);
                self.wasConsumed = false;
                self.wasClicked = false;
            }
            if (self.$.wasConsumed.wasChanged()) {
                self.wasClicked = self.wasConsumed;
            }
        }
    }
})
export class HelperGifts extends IdEntity {

    @Field({ caption: use.language.myGiftsURL, allowApiUpdate: Roles.admin })
    giftURL: string;
    @ChangeDateColumn({ caption: use.language.createDate })
    dateCreated: Date;
    @Field({ caption: use.language.createUser, allowApiUpdate: false })
    userCreated: Helpers;
    @Field({ caption: use.language.volunteer, allowApiUpdate: Roles.admin })
    @DataControl<HelperGifts, Helpers>({
        click: (x, col) => {
            HelpersBase.showSelectDialog(col, { includeFrozen: true });
        }
    })
    assignedToHelper: HelpersBase;
    @ChangeDateColumn({ caption: use.language.dateGranted })
    dateGranted: Date;
    @Field({ caption: use.language.assignUser, allowApiUpdate: false })
    assignedByUser: Helpers;
    @Field({ caption: 'מתנה מומשה' })
    wasConsumed: boolean;
    @Field()
    wasClicked: boolean;


    constructor(private context: Context) {
        super();
    }
    @ServerFunction({ allowed: Roles.admin })
    static async assignGift(helperId: string, context?: Context) {
        let helper = await HelperId.fromJson(helperId, context);
        if (await context.for(HelperGifts).count(g => g.assignedToHelper.isEqualTo(context.get(currentUser))) > 0) {
            let g = await context.for(HelperGifts).findFirst(g => g.assignedToHelper.isEqualTo(context.get(currentUser)));
            if (g) {
                g.assignedToHelper = helper;
                g.wasConsumed = false;
                g.wasClicked = false;
                await g.save();
                return;
            }
        }

        throw new Error('אין מתנות לחלוקה');
    }
    @ServerFunction({ allowed: Roles.admin })
    static async importUrls(urls: string[], context?: Context) {
        for (const url of urls) {
            let g = await context.for(HelperGifts).findFirst(g => g.giftURL.contains(url.trim()));
            if (!g) {
                g = context.for(HelperGifts).create();
                g.giftURL = url;
                await g.save();
            }
        }
    }
    @ServerFunction({ allowed: true })
    static async getMyPendingGiftsCount(h: Helpers, context?: Context) {
        let gifts = await context.for(HelperGifts).find({ where: hg => hg.assignedToHelper.isEqualTo(h).and(hg.wasConsumed.isEqualTo(false)) });
        return gifts.length;
    }

    @ServerFunction({ allowed: true })
    static async getMyFirstGiftURL(h: HelpersBase, context?: Context) {
        let gifts = await context.for(HelperGifts).find({
            where: hg => hg.assignedToHelper.isEqualTo(h).and(hg.wasConsumed.isEqualTo(false)),
            limit: 100
        });
        if (gifts == null)
            return null;
        return gifts[0].giftURL;
    }
};





export async function showUsersGifts(helperId: string, context: Context, settings: ApplicationSettings, dialog: DialogService, busy: BusyService): Promise<void> {
    openDialog(MyGiftsDialogComponent, x => x.args = {
        helperId: helperId
    });
}

export async function showHelperGifts(hid: Helpers, context: Context, settings: ApplicationSettings, dialog: DialogService, busy: BusyService): Promise<void> {


    let helperName = hid.name;
    openDialog(GridDialogComponent, x => x.args = {
        title: 'משאלות למתנדב:' + helperName,

        buttons: [{
            text: 'הענק משאלה',
            visible: () => context.isAllowed(Roles.admin),
            click: async x => {
                await HelperGifts.assignGift(hid.id);
                //this.refresh();
            },
        }],
        settings: new GridSettings(context.for(HelperGifts), {
            allowUpdate: true,

            rowsInPage: 50,
            where: hg => hg.assignedToHelper.isEqualTo(hid)
            ,
            knowTotalRows: true,
            numOfColumnsInGrid: 10,
            columnSettings: hg => [
                { width: '300', column: hg.giftURL },
                { width: '50', column: hg.wasConsumed },
                hg.dateGranted,
                hg.assignedByUser
            ],
        })
    });
}



