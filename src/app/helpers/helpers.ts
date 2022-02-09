import { Remult, IdEntity, UserInfo, Filter, Entity, BackendMethod, FieldOptions, Validators, FieldRef, FieldMetadata, FieldsMetadata, Allow, isBackend, SqlDatabase } from 'remult';
import { DataControl, DataControlInfo, DataControlSettings, GridSettings } from '@remult/angular/interfaces';
import { DateTimeColumn, logChanges, ChangeDateColumn, Email } from '../model-shared/types';
import { SqlBuilder, SqlFor } from "../model-shared/SqlBuilder";
import { isPhoneValidForIsrael, Phone } from "../model-shared/phone";

import { Roles } from "../auth/roles";

import { getLang } from '../sites/sites';
import { AddressHelper, Location } from '../shared/googleApiHelpers';
import { routeStats } from '../asign-family/route-strategy';
import { ApplicationSettings, getSettings } from '../manage/ApplicationSettings';
import { GridDialogComponent } from '../grid-dialog/grid-dialog.component';

import { DialogService } from '../select-popup/dialog';
import { FamilyStatus } from '../families/FamilyStatus';
import { InputAreaComponent } from '../select-popup/input-area/input-area.component';

import { use, Field, FieldType, IntegerField } from '../translate';
import { DistributionCenters } from '../manage/distribution-centers';
import { DateOnlyField } from 'remult/src/remult3';
import { InputTypes } from 'remult/inputTypes';
import { EntityFilter } from 'remult';
import { UITools } from './init-context';



export function CompanyColumn<entityType = any>(settings?: FieldOptions<entityType, string>) {
    return (target, key) => {
        DataControl<any, string>({
            width: '300'
        })(target, key);

        return Field<entityType, string>({
            clickWithTools: (e, col, ui) => ui.selectCompany(x => col.value = x),
            translation: l => l.company,
            ...settings
        })(target, key);
    }
}


@FieldType<HelpersBase>({

    displayValue: (e, x) => x ? x.name : '',
    translation: l => l.volunteer,
    valueConverter: {
        toJson: x => x != undefined ? x : '',
        fromJson: x => x ? x : null
    },
    clickWithTools: async (e, col, ui) => ui.selectHelper({
        onSelect: s => col.value = s
    })
})
@DataControl<any, Helpers>({
    getValue: (e, val) => val.value ? val.value.name : '',
    hideDataOnInput: true,
})
@Entity<HelpersBase>("HelpersBase", {
    dbName: "Helpers",
    allowApiCrud: false,
    allowApiRead: Allow.authenticated
},
    (options, remult) => options.apiPrefilter = {
        id: !remult.authenticated() ? [] :
            remult.isAllowed([Roles.admin, Roles.distCenterAdmin, Roles.lab]) ? undefined :
                [remult.user.id, remult.user.theHelperIAmEscortingId]

    }
)
export abstract class HelpersBase extends IdEntity {

    getHelper(): Promise<Helpers> {
        return this.remult.repo(Helpers).findId(this.id);
    }
    isCurrentUser(): boolean {
        return this.id == this.remult.user.id;
    }

    constructor(protected remult: Remult) {

        super();
    }
    @Field<HelpersBase>({
        translation: l => l.volunteerName,
        validate: (h) => {
            if (!h.name)
                h.$.name.error = getLang(h.remult).nameIsTooShort;
        }
    })
    name: string;

    @Field({ translation: l => l.phone })
    phone: Phone;
    @DateTimeColumn({ translation: l => l.smsDate })
    smsDate: Date;

    @Field()
    doNotSendSms: boolean = false;
    @CompanyColumn()
    company: string;
    @IntegerField({ allowApiUpdate: Roles.distCenterAdmin })
    totalKm: number;
    @IntegerField({ allowApiUpdate: Roles.distCenterAdmin })
    totalTime: number;
    @Field({ includeInApi: Roles.distCenterAdmin })
    shortUrlKey: string;

    @Field({ allowApiUpdate: Roles.admin })
    distributionCenter: DistributionCenters;

    @Field({
        translation: l => l.helperComment,
        allowApiUpdate: Roles.admin,
        customInput: c => c.textArea()
    })
    eventComment: string;

    @Field({
        allowApiUpdate: Roles.admin
    })
    needEscort: boolean;


    @Field({
        translation: l => l.assignedDriver,
        allowApiUpdate: Roles.admin,
        lazy: true
    })
    theHelperIAmEscorting: HelpersBase;



    @Field({
        translation: l => l.escort
        , allowApiUpdate: Roles.admin
        , lazy: true
    })
    escort: HelpersBase;

    @Field({
        translation: l => l.leadHelper
        , allowApiUpdate: Roles.admin
    })
    leadHelper: HelpersBase;
    @Field({
        allowApiUpdate: Roles.admin,
        includeInApi: Roles.admin,
        translation: l => l.myGiftsURL
    })
    myGiftsURL: string;
    @Field({
        allowApiUpdate: Roles.admin,
        includeInApi: Roles.admin,
    })
    archive: boolean;

    @Field({
        allowApiUpdate: Allow.authenticated,
        includeInApi: Allow.authenticated,
    })
    @DateOnlyField()
    frozenTill: Date;
    @Field({
        allowApiUpdate: Roles.admin,
        includeInApi: Roles.admin,
        translation: l => l.helperInternalComment
    })
    internalComment: string;
    @Field<Helpers>({}, (options, remult) => options.
        sqlExpression = async (selfDefs) => {
            let sql = new SqlBuilder(remult);
            let self = SqlFor(selfDefs);
            return sql.case([{ when: [sql.or(sql.build(self.frozenTill, ' is null'), self.where({ frozenTill: { "<=": new Date() } }))], then: false }], true);
        }
    )
    isFrozen: boolean;



    static active: EntityFilter<HelpersBase> = {
        archive: false
    }
    async deactivate() {
        this.archive = true;
        this.save();
    }

    async reactivate() {
        this.archive = false;
        this.save();
    }

    getRouteStats(): routeStats {
        return {
            totalKm: this.totalKm,
            totalTime: this.totalTime
        }
    }
}


@Entity<Helpers>("Helpers", {
    allowApiRead: Allow.authenticated,
    allowApiDelete: Allow.authenticated,
    allowApiUpdate: Allow.authenticated,
    allowApiInsert: true,
    saving: async (self) => {
        if (self._disableOnSavingRow) return;
        if (self.escort) {
            if (self.escort.id == self.id)
                self.escort = null;
        }

        if (isBackend()) {

            let canUpdate = false;
            if (self.isNew())
                canUpdate = true;
            else {
                let updatingMyOwnHelperInfo = self.$.id.originalValue == self.remult.user.id;
                if (updatingMyOwnHelperInfo) {
                    if (!self.$.admin.originalValue && !self.$.distCenterAdmin.originalValue)
                        canUpdate = true;
                    if (self.$.admin.originalValue && self.remult.isAllowed([Roles.admin, Roles.overview]))
                        canUpdate = true;
                    if (self.$.distCenterAdmin.originalValue && self.remult.isAllowed(Roles.distCenterAdmin))
                        canUpdate = true;
                    if (!self.realStoredPassword && self.realStoredPassword.length == 0) //it's the first time I'm setting the password
                        canUpdate = true;
                    if (([self.$.admin, self.$.distCenterAdmin, self.$.password].filter(x => x.valueChanged()).length == 0))
                        canUpdate = true;
                }
                else {
                    if (self.remult.isAllowed(Roles.admin))
                        canUpdate = true;

                    if (self.remult.isAllowed(Roles.distCenterAdmin)) {
                        if (!self.$.admin.originalValue && !self.$.distCenterAdmin.originalValue) {
                            canUpdate = true;
                            if (self.distCenterAdmin) {
                                self.distributionCenter = await self.remult.getUserDistributionCenter();
                            }
                        }
                        if (self.$.distCenterAdmin.originalValue && self.$.distributionCenter.originalValue && self.$.distributionCenter.originalValue.matchesCurrentUser())
                            canUpdate = true;
                        if (self.$.distCenterAdmin.originalValue || self.admin) {
                            if (!canUpdate)
                                canUpdate = [self.$.name, self.$.phone, self.$.password, self.$.distCenterAdmin, self.$.distributionCenter, self.$.admin]
                                    .filter(x => x.valueChanged()).length == 0;
                        }
                    }

                }
            }
            if (self.$.leadHelper.valueChanged() && self.leadHelper) {
                if (self.leadHelper.id == self.id || self.leadHelper.leadHelper?.id == self.id) {
                    self.$.leadHelper.error = getLang(self.remult).invalidValue;
                    return;
                }
            }

            if (!canUpdate)
                throw "Not Allowed";
            if (self.password && self.$.password.valueChanged() && self.password != Helpers.emptyPassword) {
                let remult = self.remult;
                let password = self.$.password;
                validatePasswordColumn(remult, password);
                if (self.$.password.error)
                    return;
                //throw self.password.metadata.caption + " - " + self.password.validationError;
                self.realStoredPassword = await Helpers.generateHash(self.password);
                self.passwordChangeDate = new Date();
            }
            if (self.isNew() && (await self.remult.repo(Helpers).count()) == 0) {

                self.admin = true;
            }
            self.phone = new Phone(Phone.fixPhoneInput(self.phone?.thePhone, self.remult));
            if (!self._disableDuplicateCheck)
                await Validators.unique(self, self.$.phone, self.remult.lang?.alreadyExist);
            if (self.isNew())
                self.createDate = new Date();
            self.veryUrlKeyAndReturnTrueIfSaveRequired();
            if (!self.needEscort)
                self.escort = null;
            if (self.$.escort.valueChanged()) {
                let h = self.escort;
                if (self.$.escort.originalValue) {
                    self.$.escort.originalValue.theHelperIAmEscorting = (await self.remult.getCurrentUser());
                    await self.$.escort.originalValue.save();
                }
                if (self.escort) {
                    h.theHelperIAmEscorting = self;
                    await h.save();
                }
            }
            await self.preferredDistributionAreaAddressHelper.updateApiResultIfChanged();
            await self.preferredFinishAddressHelper.updateApiResultIfChanged();

            logChanges(self._, self.remult, {
                excludeColumns: [
                    self.$.smsDate,
                    self.$.createDate,
                    self.$.lastSignInDate,
                    self.$.reminderSmsDate,
                    self.$.totalKm,
                    self.$.totalTime,
                    self.$.allowedIds,
                    self.$.addressApiResult,
                    self.$.addressApiResult2,
                    self.$.password,
                    self.$.shortUrlKey,
                    self.$.passwordChangeDate
                ],
                excludeValues: [self.$.realStoredPassword]
            })
        }


    }
}, (options, remult) =>
    options.apiPrefilter = {
        id: !remult.authenticated() ? [] : undefined,
        allowedIds: !remult.isAllowed([Roles.admin, Roles.distCenterAdmin, Roles.lab]) ? { $contains: remult.user.id } : undefined
    }
)

export class Helpers extends HelpersBase {

    static async generateHash(password: string) {
        return await (await import('password-hash')).generate(password)
    }
    static async verifyHash(password: string, hash: string) {
        return (await import('password-hash')).verify(password, hash);
    }


    async getHelper(): Promise<Helpers> {
        return this;
    }
    async displayEditDialog(ui: UITools) {
        let settings = (await this.remult.getSettings());
        await ui.inputAreaDialog({
            title: this.isNew() ? settings.lang.newVolunteers : this.name,
            ok: async () => {
                await this.save();
            },
            validate: async () => {
                if (!this.phone) {
                    this.phone = new Phone('');
                }
                this.$.phone.error = '';
                this.phone = new Phone(Phone.fixPhoneInput(this.phone.thePhone, this.remult))
                Phone.validatePhone(this.$.phone, this.remult, true);
                if (this.$.phone.error)
                    throw this.$.phone.error;
            },
            cancel: () => {
                this._.undoChanges();
            },
            settings: {
                fields: () => {
                    let r = Helpers.selectColumns(this._.repository.metadata.fields, this.remult).map(map => {

                        return ({
                            ...map,
                            field: this.$.find(map.field ? map.field as any : map)
                        })
                    });

                    return r;
                }
            },
            buttons: [{
                text: settings.lang.deliveries,
                click: () => this.showDeliveryHistory(ui)
            }, {

                text: this.remult.lang.smsMessages,
                click: async () => {
                    this.smsMessages(ui);
                },


            }]

        });
    }
    static selectColumns(self: FieldsMetadata<Helpers>, remult: Remult) {
        let settings = getSettings(remult);
        let r: DataControlSettings<Helpers>[] = [
            {
                field: self.name,
                width: '150'
            },
            {
                field: self.phone,
                width: '150'
            },
        ];
        r.push({
            field: self.eventComment,
            width: '120'
        });

        if (remult.isAllowed(Roles.admin) && settings.isSytemForMlt) {
            r.push({
                field: self.isIndependent,
                width: '120'
            });
        };

        if (remult.isAllowed(Roles.admin)) {
            r.push({
                field: self.admin,
                width: '160'
            });

        }
        if (remult.isAllowed(Roles.distCenterAdmin)) {
            r.push({
                field: self.distCenterAdmin, width: '160'
            });
        }
        let hadCenter = false;
        if (remult.isAllowed(Roles.lab) && settings.isSytemForMlt) {
            r.push({
                field: self.labAdmin, width: '120'
            });
            hadCenter = true;
            r.push({
                field: self.distributionCenter, width: '150',
            });
        }

        r.push({
            field: self.preferredDistributionAreaAddress, width: '120',
        });
        r.push({
            field: self.preferredFinishAddress, width: '120',
        });
        r.push(self.createDate);

        if (remult.isAllowed(Roles.admin) && settings.isSytemForMlt) {
            r.push({
                field: self.frozenTill, width: '120'
            });
            r.push({
                field: self.internalComment, width: '120'
            });
        }

        if (remult.isAllowed(Roles.admin) && settings.isSytemForMlt) {
            r.push({
                field: self.referredBy, width: '120'
            });
        }

        r.push({
            field: self.company, width: '120'
        });



        if (remult.isAllowed(Roles.admin) && !hadCenter) {
            r.push(self.distributionCenter);
        }
        r.push(self.email);
        if (settings.manageEscorts) {
            r.push(self.escort, self.theHelperIAmEscorting, self.needEscort);
        }

        r.push({
            field: self.socialSecurityNumber, width: '80'
        });
        r.push(self.leadHelper);
        if (settings.bulkSmsEnabled) {
            r.push(self.doNotSendSms);
            r.push({
                field: self.frozenTill, width: '120'
            });
        }

        return r;
    }

    userRequiresPassword() {
        return this.admin || this.distCenterAdmin || this.labAdmin || this.isIndependent;
    }
    async showDeliveryHistory(ui: UITools) {
        let ctx = this.remult.repo((await import('../families/FamilyDeliveries')).FamilyDeliveries);
        const settings = new GridSettings(ctx, {
            numOfColumnsInGrid: 7,
            knowTotalRows: true,
            allowSelection: true,
            rowButtons: [{

                name: '',
                icon: 'edit',
                showInLine: true,
                click: async fd => {
                    fd.showDetailsDialog({

                        ui: ui
                    });
                }
                , textInMenu: () => use.language.deliveryDetails
            }
            ],
            gridButtons: [{

                name: use.language.updateDefaultVolunteer,
                visible: () => settings.selectedRows.length > 0,
                click: async () => {
                    let deliveries: import('../families/FamilyDeliveries').FamilyDeliveries[] = settings.selectedRows;
                    await this.setAsDefaultVolunteerToDeliveries(deliveries, ui);
                }
            }],
            rowCssClass: fd => fd.getCss(),
            columnSettings: fd => {
                let r: FieldMetadata[] = [
                    fd.deliverStatus,
                    fd.deliveryStatusDate,
                    fd.basketType,
                    fd.quantity,
                    fd.name,
                    fd.address,
                    fd.courierComments,
                    fd.distributionCenter
                ]
                r.push(...[...fd].filter(c => !r.includes(c) && c != fd.id && c != fd.familySource).sort((a, b) => a.caption.localeCompare(b.caption)));
                return r;
            },

            where: { courier: this },
            orderBy: { deliveryStatusDate: "desc" },
            rowsInPage: 25

        });
        ui.gridDialog({
            title: use.language.deliveriesFor + ' ' + this.name,
            stateName: 'deliveries-for-volunteer',
            settings
        });
    }


    static usingCompanyModule: boolean;

    constructor(remult: Remult) {

        super(remult);
    }
    @Field<Helpers>({},
        (options, remult) => options.sqlExpression = async (selfDefs) => {
            let self = SqlFor(selfDefs);
            let sql = new SqlBuilder(remult);
            return sql.build(self.id, ' || ', self.escort, ' || ', self.theHelperIAmEscorting);
        }
    )
    allowedIds: string;


    _disableOnSavingRow = false;
    _disableDuplicateCheck = false;
    public static emptyPassword = 'password';

    @Field({ translation: l => l.phone })
    phone: Phone;
    @ChangeDateColumn()
    lastSignInDate: Date;
    @Field({
        dbName: 'password',
        includeInApi: false
    })
    realStoredPassword: string;
    @Field({ translation: l => l.socialSecurityNumber })
    socialSecurityNumber: string;
    @Field()
    email: Email;
    @Field()
    addressApiResult: string;
    @Field({ translation: l => l.preferredDistributionArea, customInput: i => i.addressDialog() })
    preferredDistributionAreaAddress: string;
    preferredDistributionAreaAddressHelper = new AddressHelper(this.remult,
        () => this.$.preferredDistributionAreaAddress,
        () => this.$.addressApiResult);


    async setAsDefaultVolunteerToDeliveries(deliveries: import("../families/FamilyDeliveries").FamilyDeliveries[], ui: UITools) {
        let ids: string[] = [];
        let i = 0;

        await ui.doWhileShowingBusy(async () => {
            for (const fd of deliveries) {

                if (ids.includes(fd.family))
                    continue;
                ids.push(fd.family);
                i++;
                let f = await this.remult.repo((await import('../families/families')).Families).findId(fd.family);
                f.fixedCourier = fd.courier;
                f.routeOrder = fd.routeOrder;
                await f.save();
            }
        });

        let otherFamilies = await this.remult.repo((await import('../families/families')).Families).find({
            where: {
                fixedCourier: this,
                status: FamilyStatus.Active,
                id: { $ne: ids }
            }
        });
        if (otherFamilies.length > 0) {
            if (await ui.YesNoPromise(use.language.thisVolunteerIsSetAsTheDefaultFor + " " + otherFamilies.length + " " + use.language.familiesDotCancelTheseAssignments)) {
                for (const f of otherFamilies) {
                    f.fixedCourier = null;
                    await f.save();
                    i++;
                }
            }
        }

        ui.Info(i + " " + use.language.familiesUpdated);
    }
    @BackendMethod({ allowed: true })
    async mltRegister() {
        if (!this.isNew())
            throw "מתנדב קיים";
        let error = false;
        for (const col of [this.$.name, this.$.preferredDistributionAreaAddress, this.$.phone, this.$.socialSecurityNumber]) {
            col.error = '';
            if (!col.value) {
                col.error = 'שדה חובה';
                error = true;
            }
        }
        if (error)
            throw "יש למלא שדות חובה" +
            "(שם, כתובת, טלפון ות.ז.)";
        if (!isPhoneValidForIsrael(this.phone.thePhone)) {
            this.$.phone.error = "טלפון לא תקין";
            throw this.$.phone.error;
        }
        let settings = await ApplicationSettings.getAsync(this.remult);
        if (!settings.isSytemForMlt)
            throw "Not Allowed";
        this.remult.setUser({
            id: 'WIX',
            name: 'WIX',
            roles: []
        });
        await this.save();


        if (settings.registerHelperReplyEmailText && settings.registerHelperReplyEmailText != '') {
            let message = (await import('../asign-family/send-sms-action')).SendSmsAction.getMessage(settings.registerHelperReplyEmailText,
                settings.organisationName, '', this.name, this.remult.user.name, '');

            try {
                await this.email.Send(settings.lang.thankYouForHelp, message, this.remult);
            } catch (err) {
                console.error('send mail', err);
            }
        }
    }

    @Field()
    addressApiResult2: string;
    @Field({
        dbName: 'preferredDistributionAreaAddress2'
    })
    preferredFinishAddress: string;
    preferredFinishAddressHelper = new AddressHelper(this.remult, () => this.$.preferredFinishAddress, () => this.$.addressApiResult2);

    @Field<Helpers>({
        inputType: InputTypes.password,
        serverExpression: (self) => self.realStoredPassword ? Helpers.emptyPassword : ''
    })
    password: string;
    @ChangeDateColumn()
    createDate: Date;
    @ChangeDateColumn()
    passwordChangeDate: Date;
    @ChangeDateColumn()
    EULASignDate: Date;
    //    confidentialityConfirmDate = new changeDate();

    @DateTimeColumn({
        translation: l => l.remiderSmsDate
    })
    reminderSmsDate: Date;
    @Field({ includeInApi: Roles.admin })
    referredBy: string;
    @Field({
        allowApiUpdate: Roles.admin,
        includeInApi: Roles.admin,
        dbName: 'isAdmin'
    })
    admin: boolean;
    @Field({
        translation: l => l.lab,
        allowApiUpdate: Roles.lab,
        includeInApi: Roles.lab
    })
    labAdmin: boolean;
    @Field({
        translation: l => l.indie,
        allowApiUpdate: Roles.admin,
        includeInApi: Roles.admin
    })
    isIndependent: boolean;

    @Field<Helpers>({
        translation: l => l.responsibleForAssign,
        allowApiUpdate: Roles.distCenterAdmin,
        includeInApi: Roles.distCenterAdmin,

        validate: (self) => {
            if (self.remult.isAllowed(Roles.admin) || !self._disableOnSavingRow) {
                return;
            }
            if (self.$.distCenterAdmin)
                if (self.$.admin.originalValue) {
                    self.$.distCenterAdmin.error = use.language.notAllowedToUpdateVolunteer;
                }
                else if (self.distributionCenter && !self.distributionCenter.matchesCurrentUser()) {
                    self.$.distributionCenter.error = use.language.notAllowedToUpdateVolunteer;
                }

        }
    })
    distCenterAdmin: boolean;

    static deliveredPreviously = Filter.createCustom<Helpers,
        { city: string }>(((remult, { city }) => {

            return SqlDatabase.customFilter(async c => {
                let fd = SqlFor(remult.repo((await (import('../families/FamilyDeliveries'))).FamilyDeliveries));
                let helpers = SqlFor(remult.repo(Helpers));
                let sql = new SqlBuilder(remult);
                c.sql = await sql.build(helpers.id, " in (", sql.query({
                    select: () => [fd.courier],
                    from: fd,
                    where: () => [fd.where({
                        archive: true,
                        city: { $contains: city }
                    })]
                }), ")")

            });
        }))






    veryUrlKeyAndReturnTrueIfSaveRequired() {
        if (!this.shortUrlKey || this.shortUrlKey.length < 10) {
            this.shortUrlKey = makeId();
            return true;
        }
        return false;
    }

    static recentHelpers: HelpersBase[] = [];
    static addToRecent(h: HelpersBase) {
        if (!h)
            return;
        if (h.isNew())
            return;
        let index = Helpers.recentHelpers.findIndex(x => x.id == h.id);
        if (index >= 0)
            Helpers.recentHelpers.splice(index, 1);
        Helpers.recentHelpers.splice(0, 0, h);
    }
    async getActiveEventsRegistered() {
        let events = (await import('../events/events'));
        let result: import('../events/events').volunteersInEvent[] = [];
        let yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        for (const event of await this.remult.repo(events.Event).find({
            where: { eventStatus: events.eventStatus.active, eventDate: { ">=": yesterday } }
        })) {
            for (const v of await this.remult.repo(events.volunteersInEvent).find({
                where: { helper: this, eventId: event.id }
            })) {
                result.push(v);
            }
        }
        return result;
    }
    async sendSmsToCourier(ui: UITools, message = '') {
        let h = this;

        ui.editCommentDialog({
            save: async (comment) => {
                ui.Info(await Helpers.SendCustomMessageToCourier(this, comment));
            },
            title: this.remult.lang.sendMessageToVolunteer + ' ' + h.name,
            comment: this.remult.lang.hello + ' ' + h.name + '\n' + message
        });
    }
    @BackendMethod({ allowed: Roles.admin })
    static async SendCustomMessageToCourier(h: HelpersBase, message: string, remult?: Remult) {
        return await new (await (import('../asign-family/send-sms-action'))).SendSmsUtils().sendSms(h.phone.thePhone, message, remult, h);

    }
    async smsMessages(ui: UITools) {
        const HelperCommunicationHistory = (await import('../in-route-follow-up/in-route-helpers')).HelperCommunicationHistory;
        const settings = new GridSettings(this.remult.repo(HelperCommunicationHistory), {
            where: {
                volunteer: this
            },
            columnSettings: com => [
                com.message,
                com.incoming,
                com.createDate,
                com.automaticAction,
                com.apiResponse
            ],
            numOfColumnsInGrid: 4
        })
        ui.gridDialog({
            settings,
            buttons: [{
                text: this.remult.lang.customSmsMessage,
                click: () => {
                    this.sendSmsToCourier(ui);
                    settings.reloadData();
                }
            }],
            title: this.remult.lang.smsMessages + " " + this.name
        });
    }


}






export function validatePasswordColumn(remult: Remult, password: FieldRef<any, string>) {
    if (getSettings(remult).requireComplexPassword) {
        var l = getLang(remult);
        if (password.value.length < 8)
            password.error = l.passwordTooShort;
        if (!password.value.match(/^(?=.*[0-9])(?=.*[a-zA-Z])([a-zA-Z0-9]+)$/))
            password.error = l.passwordCharsRequirement;
    }
}




export function makeId() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < 10; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

