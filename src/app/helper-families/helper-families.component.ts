import { Component, OnInit, Input, ViewChild, Output, EventEmitter, ElementRef } from '@angular/core';
import { BackendMethod, SqlDatabase, FieldRef, Allow } from 'remult';
import { BusyService, DataAreaSettings, GridButton, InputField, openDialog } from '@remult/angular';
import * as copy from 'copy-to-clipboard';
import { UserFamiliesList } from '../my-families/user-families';
import { MapComponent } from '../map/map.component';

import { DeliveryStatus } from "../families/DeliveryStatus";
import { AuthService } from '../auth/auth-service';
import { DialogService } from '../select-popup/dialog';
import { SendSmsAction, SendSmsUtils } from '../asign-family/send-sms-action';

import { ApplicationSettings, getSettings } from '../manage/ApplicationSettings';
import { Remult } from 'remult';

import { use, TranslationOptions } from '../translate';
import { Helpers, HelpersBase } from '../helpers/helpers';
import { GetVolunteerFeedback } from '../update-comment/update-comment.component';
import { CommonQuestionsComponent } from '../common-questions/common-questions.component';
import { ActiveFamilyDeliveries, FamilyDeliveries } from '../families/FamilyDeliveries';
import { isGpsAddress, Location, toLongLat, GetDistanceBetween, getCurrentLocation } from '../shared/googleApiHelpers';
import { Roles } from '../auth/roles';
import { pagedRowsIterator } from '../families/familyActionsWiring';
import { MatTabGroup } from '@angular/material/tabs';

import { InputAreaComponent } from '../select-popup/input-area/input-area.component';
import { myThrottle, relativeDateName } from '../model-shared/types';
import { getValueFromResult, SqlBuilder, SqlFor } from "../model-shared/SqlBuilder";
import { Phone } from "../model-shared/phone";
import { Sites, getLang } from '../sites/sites';
import { SelectListComponent, selectListItem } from '../select-list/select-list.component';
import { EditCommentDialogComponent } from '../edit-comment-dialog/edit-comment-dialog.component';
import { SelectHelperComponent } from '../select-helper/select-helper.component';
import { moveDeliveriesHelper } from './move-deliveries-helper';

import { BasketType } from '../families/BasketType';
import { trigger, transition, style, animate } from '@angular/animations';
import { DistributionCenters } from '../manage/distribution-centers';
import { MltFamiliesComponent } from '../mlt-families/mlt-families.component';
import { FamilySources } from '../families/FamilySources';
import { routeStrategy } from '../asign-family/route-strategy';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { PromiseThrottle } from '../shared/utils';


@Component({
  selector: 'app-helper-families',
  templateUrl: './helper-families.component.html',
  styleUrls: ['./helper-families.component.scss'],
  animations: [
    trigger("message", [
      transition("void => *", [
        style({ transform: 'scale(0)', height: '0' }),
        animate('400ms ease-in')
      ]),
      transition("* => void", [
        animate('500ms ease-out', style({ transform: 'translateX(300%) scale(0) rotate(360deg)' }))
      ])
    ])
  ]
})
export class HelperFamiliesComponent implements OnInit {
  switchToMap() {
    this.tab.selectedIndex = 1;
  }
  trackBy(i: number, f: ActiveFamilyDeliveries) {
    return f.id;
  }
  signs = ["🙂", "👌", "😉", "😍", "🤩", "💖", "👍", "🙏"];
  visibleSigns: string[] = [];
  cool() {
    let x = Math.trunc(Math.random() * this.signs.length);
    this.visibleSigns.push(this.signs[x]);
    setTimeout(() => {
      this.visibleSigns.pop();
    }, 1000);
  }
  disableDrag = true;
  toggleReorder() {
    this.disableDrag = !this.disableDrag;
    if (!this.disableDrag) {
      this.dialog.Info(this.settings.lang.dragDeliveriesToChangeTheirOrder)
    }
  }
  async drop(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.familyLists.toDeliver, event.previousIndex, event.currentIndex);
    this.busy.doWhileShowingBusy(async () => {
      let t = new PromiseThrottle(15);
      let i = 1;
      for (const d of this.familyLists.toDeliver) {
        d.routeOrder = i++;
        await t.push(d.save());
      }
      await t.done();
      this.map.test(this.familyLists.toDeliver, this.familyLists.helper);
    });
  }

  constructor(public auth: AuthService, private dialog: DialogService, public remult: Remult, private busy: BusyService, public settings: ApplicationSettings) { }
  @Input() familyLists: UserFamiliesList;
  @Input() partOfAssign = false;
  @Input() partOfReview = false;
  @Input() helperGotSms = false;
  @Output() assignmentCanceled = new EventEmitter<void>();
  @Output() assignSmsSent = new EventEmitter<void>();
  @Input() preview = false;
  @ViewChild("theTab", { static: false }) tab: MatTabGroup;
  ngOnInit() {


  }
  volunteerLocation: Location = undefined;
  async updateCurrentLocation(useCurrentLocation: boolean) {

    this.volunteerLocation = await getCurrentLocation(useCurrentLocation, this.dialog);

  }

  async refreshRoute() {
    var useCurrentLocation = new InputField<boolean>({ caption: use.language.useCurrentLocationForStart, valueType: Boolean });
    var strategy = new InputField<routeStrategy>({ valueType: routeStrategy, caption: use.language.routeOptimization });
    strategy.value = this.settings.routeStrategy;

    await openDialog(InputAreaComponent, x => x.args = {
      title: use.language.replanRoute,
      settings: {
        fields: () => [
          { field: useCurrentLocation, visible: () => !this.partOfAssign && !this.partOfReview && !!navigator.geolocation },
          { field: this.familyLists.helper.$.preferredFinishAddress, visible: () => !this.settings.isSytemForMlt() },
          { field: strategy, visible: () => !this.familyLists.helper.preferredFinishAddress || this.familyLists.helper.preferredFinishAddress.trim().length == 0 || this.settings.isSytemForMlt() }
        ]
      },
      cancel: () => { },
      ok: async () => {
        await this.updateCurrentLocation(useCurrentLocation.value);
        if (this.familyLists.helper.wasChanged())
          await this.familyLists.helper.save();
        await this.familyLists.refreshRoute({
          volunteerLocation: this.volunteerLocation
        }, strategy.value);
      }
    });


  }
  reminderSmsRelativeDate() {
    return relativeDateName(this.remult, { d: this.familyLists.helper.reminderSmsDate });
  }


  @BackendMethod({ allowed: Roles.indie })
  static async getDeliveriesByLocation(pivotLocation: Location, selfAssign: boolean, remult?: Remult, db?: SqlDatabase) {
    if (!getSettings(remult).isSytemForMlt())
      throw "not allowed";
    let result: selectListItem<DeliveryInList>[] = [];

    let fd = SqlFor(remult.repo(ActiveFamilyDeliveries));

    let sql = new SqlBuilder(remult);
    let settings = await ApplicationSettings.getAsync(remult);
    let privateDonation = selfAssign ? (await remult.repo(FamilySources).findFirst(x => x.name.isEqualTo('תרומה פרטית'))) : null;

    for (const r of (await db.execute(await sql.query({
      select: () => [
        fd.addressLatitude,
        fd.addressLongitude,
        fd.quantity,
        fd.basketType,
        fd.id,
        fd.family,
        fd.floor,
        fd.city],
      from: fd,
      where: () => {
        if (selfAssign) {
          return [fd.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery).and(fd.courier.isEqualTo(null)).and((fd.familySource.isIn([null, privateDonation])))];
        } else {
          return [fd.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery).and(fd.courier.isEqualTo(null))];
        }
      }
    }))).rows) {
      let existing = result.find(async x => x.item.familyId == await getValueFromResult(r, fd.family));
      let basketName = (await remult.repo(BasketType).findFirst(async x => x.id.isEqualTo(await getValueFromResult(r, fd.basketType)))).name;
      if (existing) {
        existing.name += ", " + await getValueFromResult(r, fd.quantity) + " X " + basketName;
        existing.item.totalItems += await getValueFromResult(r, fd.quantity);
        existing.item.ids.push(await getValueFromResult(r, fd.id));

      }
      else {
        let loc: Location = {
          lat: +await getValueFromResult(r, fd.addressLatitude),
          lng: +await getValueFromResult(r, fd.addressLongitude)
        };
        let dist = GetDistanceBetween(pivotLocation, loc);
        let myItem: DeliveryInList = {

          city: await getValueFromResult(r, fd.city),
          floor: await getValueFromResult(r, fd.floor),

          ids: [await getValueFromResult(r, fd.id)],
          familyId: await getValueFromResult(r, fd.family),
          location: loc,
          distance: dist,
          totalItems: await getValueFromResult(r, fd.quantity)
        };
        let itemString: string =
          myItem.distance.toFixed(1) + use.language.km +
          (myItem.city ? ' (' + myItem.city + ')' : '') +
          (myItem.floor ? ' [' + use.language.floor + ' ' + myItem.floor + ']' : '') +
          ' : ' +
          await getValueFromResult(r, fd.quantity) + ' x ' + basketName;

        result.push({
          selected: false,
          item: myItem,
          name: itemString
        });
      }
    }
    let calcAffectiveDistance = (await (import('../volunteer-cross-assign/volunteer-cross-assign.component'))).calcAffectiveDistance;
    result.sort((a, b) => {
      return calcAffectiveDistance(a.item.distance, a.item.totalItems) - calcAffectiveDistance(b.item.distance, b.item.totalItems);
    });
    if (selfAssign) {
      let removeFam = -1;

      do {
        removeFam = result.findIndex(f => f.item.totalItems > settings.MaxItemsQuantityInDeliveryThatAnIndependentVolunteerCanSee);
        if (removeFam >= 0) {
          result.splice(removeFam, 1);
        }
      } while (removeFam >= 0)
    }
    result.splice(15);
    return result;
  };




  async assignNewDelivery() {
    await this.updateCurrentLocation(true);
    let afdList = await (HelperFamiliesComponent.getDeliveriesByLocation(this.volunteerLocation, false));

    await openDialog(SelectListComponent, x => {
      x.args = {
        title: use.language.closestDeliveries + ' (' + use.language.mergeFamilies + ')',
        multiSelect: true,
        onSelect: async (selectedItems) => {
          if (selectedItems.length > 0)
            this.busy.doWhileShowingBusy(async () => {
              let ids: string[] = [];
              for (const selectedItem of selectedItems) {
                let d: DeliveryInList = selectedItem.item;
                ids.push(...d.ids);
              }
              await MltFamiliesComponent.assignFamilyDeliveryToIndie(ids);
              await this.familyLists.refreshRoute({
                volunteerLocation: this.volunteerLocation
              });
              if (this.familyLists)
                await this.familyLists.reload();
            });
        },
        options: afdList
      }
    });


  }
  reloadList() {
    this.familyLists.reload();
  }

  getHelpText() {
    var r = this.settings.lang.ifYouNeedAnyHelpPleaseCall;
    r += " ";
    if (this.settings.helpText && this.settings.helpPhone)
      return r + this.settings.helpText + ", " + this.settings.helpPhone.displayValue;
    else {
      var h = this.remult.currentUser;
      return r + h.name + ", " + h.phone.displayValue;
    }
  }

  buttons: GridButton[] = [];
  prevMap: MapComponent;
  lastBounds: string;
  mapTabClicked() {
    if (this.map && this.map != this.prevMap) {
      this.familyLists.setMap(this.map);
      this.prevMap = this.map;
    }
    if (this.map) {
      if (this.tab.selectedIndex == 1 && this.lastBounds != this.map.lastBounds) {
        this.map.lastBounds = '';
        this.map.fitBounds();
      }
      this.lastBounds = this.map.lastBounds;
    }

  }
  async cancelAssign(f: ActiveFamilyDeliveries) {
    this.dialog.analytics('Cancel Assign');
    f.courier = null;
    await f.save();
    this.familyLists.reload();
    this.assignmentCanceled.emit();
  }
  cancelAll() {
    this.dialog.YesNoQuestion(use.language.areYouSureYouWantToCancelAssignmentTo + " " + this.familyLists.toDeliver.length + " " + use.language.families + "?", async () => {
      await this.busy.doWhileShowingBusy(async () => {

        this.dialog.analytics('cancel all');
        await HelperFamiliesComponent.cancelAssignAllForHelperOnServer(this.familyLists.helper);
        this.familyLists.reload();
        this.assignmentCanceled.emit();
      });
    });

  }
  setDefaultCourier() {
    this.familyLists.helper.setAsDefaultVolunteerToDeliveries(this.busy, this.familyLists.toDeliver, this.dialog);
  }
  @BackendMethod({ allowed: Roles.distCenterAdmin })
  static async cancelAssignAllForHelperOnServer(helper: HelpersBase, remult?: Remult) {
    let dist: DistributionCenters = null;
    await pagedRowsIterator(remult.repo(ActiveFamilyDeliveries), {
      where: fd => FamilyDeliveries.onTheWayFilter().and(fd.courier.isEqualTo(helper)),
      forEachRow: async fd => {
        fd.courier = null;
        fd._disableMessageToUsers = true;
        dist = fd.distributionCenter;
        await fd.save();
      }
    });
    await dist.SendMessageToBrowser(getLang(remult).cancelAssignmentForHelperFamilies, remult);
  }
  distanceFromPreviousLocation(f: ActiveFamilyDeliveries, i: number): number {
    if (i == 0) { return undefined; }
    if (!f.addressOk)
      return undefined;
    let of = this.familyLists.toDeliver[i - 1];
    if (!of.addressOk)
      return undefined;
    return GetDistanceBetween(of.getDrivingLocation(), f.getDrivingLocation());
  }
  @BackendMethod({ allowed: Roles.distCenterAdmin })
  static async okAllForHelperOnServer(helper: HelpersBase, remult?: Remult) {
    let dist: DistributionCenters = null;

    await pagedRowsIterator(remult.repo(ActiveFamilyDeliveries), {
      where: fd => FamilyDeliveries.onTheWayFilter().and(fd.courier.isEqualTo(helper)),
      forEachRow: async fd => {
        dist = fd.distributionCenter;
        fd.deliverStatus = DeliveryStatus.Success;
        fd._disableMessageToUsers = true;
        await fd.save();
      }
    });
    if (dist)
      await dist.SendMessageToBrowser(use.language.markAllDeliveriesAsSuccesfull, remult);
  }
  notMLT() {
    return !this.settings.isSytemForMlt();
  }

  limitReady = new limitList(30, () => this.familyLists.toDeliver.length);
  limitDelivered = new limitList(10, () => this.familyLists.delivered.length);
  okAll() {
    this.dialog.YesNoQuestion(use.language.areYouSureYouWantToMarkDeliveredSuccesfullyToAllHelperFamilies + this.familyLists.toDeliver.length + " " + use.language.families + "?", async () => {
      await this.busy.doWhileShowingBusy(async () => {

        this.dialog.analytics('ok all');
        await HelperFamiliesComponent.okAllForHelperOnServer(this.familyLists.helper);
        this.familyLists.reload();
      });
    });
  }
  async moveBasketsTo(to: HelpersBase) {
    await new moveDeliveriesHelper(this.remult, this.settings, this.dialog, () => this.familyLists.reload()).move(this.familyLists.helper, to, true, '', true);

  }

  moveBasketsToOtherVolunteer() {
    openDialog(
      SelectHelperComponent, s => s.args = {
        filter: h => h.id.isDifferentFrom(this.familyLists.helper.id),
        hideRecent: true,
        onSelect: async to => {
          if (to) {
            this.moveBasketsTo(to);
          }
        }
      });
  }
  async refreshDependentVolunteers() {

    this.otherDependentVolunteers = [];

    this.busy.donotWaitNonAsync(async () => {
      if (this.familyLists.helper.leadHelper) {
        this.otherDependentVolunteers.push(this.familyLists.helper.leadHelper);
      }
      this.otherDependentVolunteers.push(...await this.remult.repo(Helpers).find({ where: h => h.leadHelper.isEqualTo(this.familyLists.helper) }));
    });
  }
  otherDependentVolunteers: HelpersBase[] = [];

  allDoneMessage() { return ApplicationSettings.get(this.remult).messageForDoneDelivery; };
  async deliveredToFamily(f: ActiveFamilyDeliveries) {
    this.deliveredToFamilyOk(f, DeliveryStatus.Success, s => s.commentForSuccessDelivery);
  }
  async leftThere(f: ActiveFamilyDeliveries) {
    this.deliveredToFamilyOk(f, DeliveryStatus.SuccessLeftThere, s => s.commentForSuccessLeft);
  }
  @BackendMethod({ allowed: Allow.authenticated })
  static async sendSuccessMessageToFamily(deliveryId: string, remult?: Remult) {
    var settings = getSettings(remult);
    if (!settings.allowSendSuccessMessageOption)
      return;
    if (!settings.sendSuccessMessageToFamily)
      return;
    let fd = await remult.repo(ActiveFamilyDeliveries).findFirst(f => f.id.isEqualTo(deliveryId).and(f.visibleToCourier.isEqualTo(true)).and(f.deliverStatus.isIn([DeliveryStatus.Success, DeliveryStatus.SuccessLeftThere])));
    if (!fd)
      console.log("did not send sms to " + deliveryId + " failed to find delivery");
    if (!fd.phone1)
      return;
    if (!fd.phone1.canSendWhatsapp())
      return;
    let phone = Phone.fixPhoneInput(fd.phone1.thePhone, remult);
    if (phone.length != 10) {
      console.log(phone + " doesn't match sms structure");
      return;
    }


    await new SendSmsUtils().sendSms(phone, settings.helpPhone.thePhone, SendSmsAction.getSuccessMessage(settings.successMessageText, settings.organisationName, fd.name), remult.getOrigin(), Sites.getOrganizationFromContext(remult), settings);
  }
  async deliveredToFamilyOk(f: ActiveFamilyDeliveries, status: DeliveryStatus, helpText: (s: ApplicationSettings) => string) {
    openDialog(GetVolunteerFeedback, x => x.args = {
      family: f,
      comment: f.courierComments,
      helpText,
      questionsArea: new DataAreaSettings({
        fields: () => [
          f.$.a1, f.$.a2, f.$.a3, f.$.a4
        ]
      }),
      ok: async (comment) => {
        if (!f.isNew()) {
          f.deliverStatus = status;
          f.courierComments = comment;
          f.checkNeedsWork();
          try {
            await f.save();
            this.cool();
            this.dialog.analytics('delivered');
            this.initFamilies();
            if (this.familyLists.toDeliver.length == 0) {
              this.dialog.messageDialog(this.allDoneMessage());
            }
            if (this.settings.allowSendSuccessMessageOption && this.settings.sendSuccessMessageToFamily)
              HelperFamiliesComponent.sendSuccessMessageToFamily(f.id);

          }
          catch (err) {
            this.dialog.Error(err);
          }
        }
      },
      cancel: () => {
        f._.undoChanges()
      }
    });

  }
  initFamilies() {
    this.familyLists.initFamilies();
    if (this.familyLists.toDeliver.length > 0)
      this.familyLists.toDeliver[0].distributionCenter.getRouteStartGeo().then(x => this.routeStart = x);

  }
  showLeftFamilies() {
    return this.partOfAssign || this.partOfReview || this.familyLists.toDeliver.length > 0;
  }
  async couldntDeliverToFamily(f: ActiveFamilyDeliveries) {
    let showUpdateFail = false;
    let q = this.settings.getQuestions();
    if (!q || q.length == 0) {
      showUpdateFail = true;
    } else {
      showUpdateFail = await openDialog(CommonQuestionsComponent, x => x.init(this.familyLists.allFamilies[0]), x => x.updateFailedDelivery);
    }
    if (showUpdateFail)
      openDialog(GetVolunteerFeedback, x => x.args = {
        family: f,
        comment: f.courierComments,
        showFailStatus: true,

        helpText: s => s.commentForProblem,

        ok: async (comment, status) => {
          if (f.isNew())
            return;
          f.deliverStatus = status;
          f.courierComments = comment;
          f.checkNeedsWork();
          try {
            await f.save();
            this.dialog.analytics('Problem');
            this.initFamilies();


          }
          catch (err) {
            this.dialog.Error(err);
          }
        },
        cancel: () => { },

      });
  }
  async sendSms(reminder: Boolean) {
    this.helperGotSms = true;
    this.dialog.analytics('Send SMS ' + (reminder ? 'reminder' : ''));
    let to = this.familyLists.helper.name;
    await SendSmsAction.SendSms(this.familyLists.helper, reminder);
    if (this.familyLists.helper.escort) {
      to += ' ול' + this.familyLists.escort.name;
      await SendSmsAction.SendSms(this.familyLists.helper.escort, reminder);
    }
    this.dialog.Info(use.language.smsMessageSentTo + " " + to);
    this.assignSmsSent.emit();
    if (reminder) {
      this.familyLists.helper.reminderSmsDate = new Date();
    }
  }

  async sendWhatsapp() {
    Phone.sendWhatsappToPhone(this.smsPhone, this.smsMessage, this.remult);
    await this.updateMessageSent("Whatsapp");
  }
  print() {
    let p = window.location.pathname.split('/');
    window.open("/" + p[1] + "/print-volunteer?volunteer=" + this.familyLists.helper.id, "_blank");
  }
  async customSms() {
    let h = this.familyLists.helper;
    let phone = h.phone.thePhone;
    if (phone.startsWith('0')) {
      phone = '972' + phone.substr(1);
    }
    await openDialog(GetVolunteerFeedback, x => x.args = {
      helpText: () => '',
      ok: async (comment) => {
        await (await import("../update-family-dialog/update-family-dialog.component")).UpdateFamilyDialogComponent.SendCustomMessageToCourier(this.familyLists.helper, comment);
        this.dialog.Info("הודעה נשלחה");
      },
      cancel: () => { },
      hideLocation: true,
      title: 'שלח הודעת ל' + h.name,
      family: undefined,
      comment: this.smsMessage
    });
  }
  smsMessage: string = '';
  smsPhone: string = '';
  smsLink: string = '';
  isReminderMessage: boolean = false;
  prepareMessage(reminder: boolean) {
    this.isReminderMessage = reminder;
    this.busy.donotWait(async () => {
      await SendSmsAction.generateMessage(this.remult, this.familyLists.helper, window.origin, reminder, this.remult.user.name, async (phone, message, sender, link) => {
        this.smsMessage = message;
        this.smsPhone = phone;
        this.smsLink = link;
      });
    });
  }
  async sendPhoneSms() {
    try {
      window.open('sms:' + this.smsPhone + ';?&body=' + encodeURI(this.smsMessage), '_blank');
      await this.updateMessageSent("Sms from user phone");
    } catch (err) {
      this.dialog.Error(err);
    }
  }
  async callHelper() {
    location.href = 'tel:' + this.familyLists.helper.phone;
    if (this.settings.isSytemForMlt()) {
      await openDialog(EditCommentDialogComponent, inputArea => inputArea.args = {
        title: 'הוסף הערה לתכתובות של המתנדב',

        save: async (comment) => {
          let hist = this.remult.repo((await import('../in-route-follow-up/in-route-helpers')).HelperCommunicationHistory).create();
          hist.volunteer = this.familyLists.helper;
          hist.comment = comment;
          await hist.save();
        },
        comment: 'התקשרתי'


      });
    }
  }
  callEscort() {
    window.open('tel:' + this.familyLists.escort.phone);
  }
  async updateMessageSent(type: string) {

    await SendSmsAction.documentHelperMessage(this.isReminderMessage, this.familyLists.helper, this.remult, type);
  }
  async copyMessage() {
    copy(this.smsMessage);
    this.dialog.Info(use.language.messageCopied);
    await this.updateMessageSent("Message Copied");
  }
  async copyLink() {
    copy(this.smsLink);
    this.dialog.Info(use.language.linkCopied);
    await this.updateMessageSent("Link Copied");
  }

  updateComment(f: ActiveFamilyDeliveries) {
    openDialog(GetVolunteerFeedback, x => x.args = {
      comment: f.courierComments,
      cancel: () => undefined,
      family: f,
      helpText: () => '',
      ok: async comment => {
        if (f.isNew())
          return;
        f.courierComments = comment;
        f.checkNeedsWork();
        await f.save();
        this.dialog.analytics('Update Comment');
      }
      , title: use.language.updateComment

    });
  }
  routeStart = this.settings.addressHelper.getGeocodeInformation();
  async showRouteOnGoogleMaps() {

    if (this.familyLists.toDeliver.length > 0) {

      let endOnDist = this.settings.routeStrategy.args.endOnDistributionCenter;
      let url = 'https://www.google.com/maps/dir';
      if (!endOnDist)
        if (this.volunteerLocation) {
          url += "/" + encodeURI(toLongLat(this.volunteerLocation));
        }
        else
          url += "/" + encodeURI((this.routeStart).getAddress());

      for (const f of this.familyLists.toDeliver) {
        url += '/' + encodeURI(isGpsAddress(f.address) ? f.address : f.addressByGoogle);
      }
      if (endOnDist)
        url += "/" + encodeURI((this.routeStart).getAddress());
      window.open(url + "?hl=" + getLang(this.remult).languageCode, '_blank');
    }
    //window.open(url,'_blank');
  }
  async returnToDeliver(f: ActiveFamilyDeliveries) {
    f.deliverStatus = DeliveryStatus.ReadyForDelivery;
    try {
      await f.save();
      this.dialog.analytics('Return to Deliver');
      this.initFamilies();
    }
    catch (err) {
      this.dialog.Error(err);
    }
  }
  @ViewChild("map", { static: false }) map: MapComponent;

}

export interface DeliveryInList {
  ids: string[],
  familyId: string,
  city: string,
  floor: string,
  location: Location,
  distance: number,
  totalItems: number
}

class limitList {
  constructor(public limit: number, private relevantCount: () => number) {

  }
  _showAll = false;
  showButton() {
    return !this._showAll && this.limit < this.relevantCount();
  }
  showAll() {
    this._showAll = true;
  }
  shouldShow(i: number) {
    return this._showAll || i < this.limit;
  }
}


