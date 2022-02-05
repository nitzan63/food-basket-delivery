import { Component, OnInit, Input, Output, EventEmitter, NgZone } from '@angular/core';

import * as copy from 'copy-to-clipboard';
import { DialogService } from '../select-popup/dialog';
import { extractError } from "../select-popup/extractError";
import { DeliveryStatus } from '../families/DeliveryStatus';
import { Remult, FieldRef, BackendMethod, Allow } from 'remult';

import { use } from '../translate';
import { GetVolunteerFeedback } from '../update-comment/update-comment.component';


import { ActiveFamilyDeliveries, FamilyDeliveries } from '../families/FamilyDeliveries';
import { ApplicationSettings } from '../manage/ApplicationSettings';

import { Helpers } from '../helpers/helpers';
import { getLang, Sites } from '../sites/sites';
import { Roles } from '../auth/roles';
import { Phone } from "../model-shared/phone";
import { Families } from '../families/families';
import { UserFamiliesList } from '../my-families/user-families';
import { openDialog } from '@remult/angular';
import { relativeDateName } from '../model-shared/types';
import { ImageInfo } from '../images/images.component';
import { SendSmsAction } from '../asign-family/send-sms-action';
import { PreviousDeliveryCommentsComponent } from '../previous-delivery-comments/previous-delivery-comments.component';
import { quantityHelper } from '../families/BasketType';
import { FamilyInfoController } from './family-info.controller';
const useWazeKey = "useWaze";
@Component({
  selector: 'app-family-info',
  templateUrl: './family-info.component.html',
  styleUrls: ['./family-info.component.scss']
})
export class FamilyInfoComponent implements OnInit {

  constructor(private dialog: DialogService, public remult: Remult, public settings: ApplicationSettings, private zone: NgZone) {

  }
  @Input() f: ActiveFamilyDeliveries;
  @Input() showHelp = false;
  @Input() hideSal = false;
  hasImages = false;
  images: ImageInfo[];
  async ngOnInit() {
    if (this.f) {
      this.hasImages = await FamilyDeliveries.hasFamilyImages(this.f.family, this.f.id);
    }
    this.useWaze = this.settings.lang.languageCode == 'iw';
    let x = localStorage.getItem(useWazeKey);
    if (x != undefined) {
      this.useWaze = Boolean(JSON.parse(x));
    }
    this.refreshWhatToTake();
  }
  whatToTake: string = '';
  private refreshWhatToTake() {
    let toTake = new quantityHelper();
    this.whatToTake = '';
    if (this.f.basketType) {
      toTake.parseComment(this.f.basketType.whatToTake, this.f.quantity);
      this.whatToTake = toTake.toString(', ');
    }
  }

  async loadImages() {
    this.images = await FamilyDeliveries.getFamilyImages(this.f.family, this.f.id);
  }
  actuallyShowHelp() {
    return this.showHelp && this.f.deliverStatus != DeliveryStatus.ReadyForDelivery;
  }
  async showTz() {
    this.dialog.messageDialog(await FamilyInfoComponent.ShowFamilyTz(this.f.id));
  }
  async showHistory() {
    openDialog(PreviousDeliveryCommentsComponent, x => x.args = {
      family: this.f.family
    });
  }
  courierCommentsDateRelativeDate() {
    return relativeDateName(this.remult, { d: this.f.courierCommentsDate })
  }
  @BackendMethod({ allowed: Allow.authenticated })
  static async ShowFamilyTz(deliveryId: string, remult?: Remult) {
    let s = await ApplicationSettings.getAsync(remult);
    if (!s.showTzToVolunteer)
      return "";
    var d = await remult.repo(ActiveFamilyDeliveries).findId(deliveryId);
    if (!d)
      return;
    if (!d.courier.isCurrentUser() && !remult.isAllowed([Roles.admin, Roles.distCenterAdmin]))
      return "";
    var f = await remult.repo(Families).findId(d.family);
    if (!f)
      return "";
    return f.name + ":" + f.tz;

  }
  @Input() partOfAssign: Boolean;
  @Output() assignmentCanceled = new EventEmitter<void>();

  @Input() userFamilies: UserFamiliesList;
  @Input() selfPickupScreen = false;
  useWaze: boolean;

  showCancelAssign(f: ActiveFamilyDeliveries) {
    return this.partOfAssign && f.courier && f.deliverStatus == DeliveryStatus.ReadyForDelivery;
  }
  showFamilyPickedUp(f: ActiveFamilyDeliveries) {
    return f.deliverStatus == DeliveryStatus.SelfPickup || f.deliverStatus == DeliveryStatus.ReadyForDelivery && !f.courier && this.selfPickupScreen;
  }

  async getPickupComments(f: ActiveFamilyDeliveries) {
    openDialog(GetVolunteerFeedback, x => x.args =
    {
      family: f,
      comment: f.courierComments,
      helpText: s => s.commentForSuccessDelivery,
      ok: async (comment) => {
        f.deliverStatus = DeliveryStatus.SuccessPickedUp;
        f.courierComments = comment;
        f.checkNeedsWork();
        try {
          await f.save();
          this.dialog.analytics('Self Pickup');
        }
        catch (err) {
          this.dialog.Error(err);
        }
      },
      cancel: () => { }
    });
  }

  async labSelfReception(d: ActiveFamilyDeliveries) {
    if (await this.dialog.YesNoPromise(getLang(this.remult).shouldArchiveDelivery)) {
      {
        d.archive = true;
        d.distributionCenter = await this.remult.getUserDistributionCenter();
        d.deliverStatus = DeliveryStatus.Success;
        await d.save();
      }
    }
  }
  async privateCall() {
    this.dialog.analytics("Private Call");
    let r = await FamilyInfoController.privateCall(this.f.id);
    if (r.error)
      this.dialog.Error(r.error);
    else
      this.zone.run(() => {

        window.location.href = "tel:" + r.phone;
      });


  }
  callPhone(col: Phone) {

    window.location.href = "tel:" + col.thePhone;
  }
  async sendWhatsapp(phone: Phone) {
    phone.sendWhatsapp(this.remult, SendSmsAction.getSuccessMessage(this.settings.successMessageText, this.settings.organisationName, this.f.name));
  }


  async familiyPickedUp(f: ActiveFamilyDeliveries) {
    await (this.settings.isSytemForMlt) ? this.labSelfReception(f) : this.getPickupComments(f);
  }

  async cancelAssign(f: ActiveFamilyDeliveries) {

    this.assignmentCanceled.emit();

  }
  navigate(f: ActiveFamilyDeliveries, useWaze?: boolean) {
    if (useWaze === undefined)
      useWaze = this.useWaze;
    else if (useWaze != this.useWaze) {
      localStorage.setItem(useWazeKey, JSON.stringify(useWaze));
      this.useWaze = useWaze;
    }
    if (!f.addressOk) {
      this.dialog.YesNoQuestion(use.language.addressNotOkOpenWaze, () => {
        if (useWaze)
          f.openWaze();
        else
          f.openGoogleMaps();
      });
    }
    else
      if (useWaze)
        f.openWaze();
      else
        f.openGoogleMaps();
  }
  async udpateInfo(f: ActiveFamilyDeliveries) {
    let x = f.courier;
    await f.showDetailsDialog({
      ui: this.dialog,
      refreshDeliveryStats: () => {
        x = f.courier;
        this.refreshWhatToTake();
        if (this.userFamilies)
          this.userFamilies.reload();
      }
    });
    if (x != f.courier)
      if (this.userFamilies)
        this.userFamilies.reload();

  }
  copyAddress(f: ActiveFamilyDeliveries) {
    copy(f.address);
    this.dialog.Info(use.language.address + " " + f.address + " " + use.language.wasCopiedSuccefully);
  }
  showStatus() {
    if (this.f.deliverStatus == DeliveryStatus.SelfPickup)
      return false;
    if (this.selfPickupScreen)
      return true;
    return this.f.deliverStatus != DeliveryStatus.ReadyForDelivery;
  }
}
