import { Component, OnInit } from '@angular/core';

import { MatDialogRef } from '@angular/material/dialog';
import { Helpers, HelpersBase } from '../helpers/helpers';
import { Remult } from 'remult';

import { BusyService, DialogConfig } from '@remult/angular';
import { ApplicationSettings, getSettings } from '../manage/ApplicationSettings';
import { HelpersAndStats } from '../delivery-follow-up/HelpersAndStats';

import { DialogService } from '../select-popup/dialog';
import { SelectHelperArgs } from '../helpers/init-context';
import { helperInList, SelectHelperController } from './select-helper.controller';

@Component({
  selector: 'app-select-helper',
  templateUrl: './select-helper.component.html',
  styleUrls: ['./select-helper.component.scss']
})
@DialogConfig({
  minWidth: '330px',

  maxWidth: '90vw',
  panelClass: 'select-helper-dialog'
})
export class SelectHelperComponent implements OnInit {

  searchString: string = '';
  lastFilter: string = undefined;
  public args: SelectHelperArgs;
  filteredHelpers: helperInList[] = [];
  constructor(
    private dialogRef: MatDialogRef<any>,
    private dialog: DialogService,
    public remult: Remult,
    private busy: BusyService,
    public settings: ApplicationSettings

  ) {

  }
  async addHelper() {
    let h = this.remult.repo(Helpers).create({ name: this.searchString });;
    await h.displayEditDialog(this.dialog);
    if (!h.isNew()) {
      this.select({
        helperId: h.id,
        name: h.name,
        phone: h.phone?.displayValue
      });
    }
  }
  clearHelper() {
    this.select(null);
  }
  isMlt() {
    return getSettings(this.remult).isSytemForMlt;
  }

  close() {
    this.dialogRef.close();
  }
  async byLocation() {
    this.filteredHelpers = await SelectHelperController.getHelpersByLocation(this.args.location, this.args.searchClosestDefaultFamily, this.args.familyId);
  }

  limit: 25;

  async ngOnInit() {



    if (this.args.searchByDistance)
      this.byLocation();
    else
      if (Helpers.recentHelpers.length == 0 || this.args.hideRecent)
        this.getHelpers();
      else {
        let recentHelpers = Helpers.recentHelpers;
        if (!this.args.includeFrozen) {
          recentHelpers = recentHelpers.filter(h =>
            !h.archive && !h.isFrozen
          );
        }
        this.filteredHelpers = mapHelpers(recentHelpers, x => undefined);
        this.showingRecentHelpers = true;
      }


  }
  showingRecentHelpers = false;
  moreHelpers() {
    this.limit *= 2;
    this.getHelpers();
  }
  async getHelpers() {

    await this.busy.donotWait(async () => {
      this.filteredHelpers = mapHelpers(await this.remult.repo(HelpersAndStats).find({
        orderBy: { name: "asc" },
        where: {
          name: { $contains: this.searchString },
          $and: [
            !this.args.includeFrozen ? (HelpersBase.active) : undefined,
            this.args.filter
          ]
        }

      }), x => x.deliveriesInProgress);
      this.showingRecentHelpers = false;
    });

  }
  doFilter() {
    if (this.searchString.trim() != this.lastFilter) {
      this.lastFilter = this.searchString.trim();
      this.getHelpers();
    }

  }
  showCompany() {
    return this.settings.showCompanies;
  }
  selectFirst() {
    if (this.filteredHelpers.length > 0)
      this.select(this.filteredHelpers[0]);
  }
  async select(h: helperInList) {
    let helper: HelpersBase = null;
    if (h) {
      if (!h.helper)
        h.helper = await this.remult.repo(Helpers).findId(h.helperId);
      helper = h.helper;
    }
    this.args.onSelect(helper);
    if (h && !h.helper.isNew())
      Helpers.addToRecent(h.helper);
    this.dialogRef.close();
  }
}


function mapHelpers<hType extends HelpersBase>(helpers: hType[], getFamilies: (h: hType) => number): helperInList[] {
  return helpers.map(h => ({
    helper: h,
    helperId: h.id,
    name: h.name,
    phone: h.phone?.displayValue,
    assignedDeliveries: getFamilies(h)

  } as helperInList));
}