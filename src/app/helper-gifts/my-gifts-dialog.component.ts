import { Component, OnInit } from '@angular/core';
import { Remult } from 'remult';
import { Helpers } from '../helpers/helpers';

import { ApplicationSettings } from '../manage/ApplicationSettings';
import { relativeDateName } from '../model-shared/types';
import { HelperGifts } from './HelperGifts';

@Component({
  selector: 'app-my-gifts-dialog',
  templateUrl: './my-gifts-dialog.component.html',
  styleUrls: ['./my-gifts-dialog.component.scss']
})
export class MyGiftsDialogComponent implements OnInit {

  theGifts: any[] = [];
  giftsUsed = 0;
  giftsAvailable = 0;
  args: {
    helperId: string;
  };

  constructor(
    private remult: Remult,
    public settings: ApplicationSettings
  ) { }

  async ngOnInit() {
    this.giftsUsed = 0;
    this.giftsAvailable = 0;
    let helper = await this. remult.repo(Helpers).findId(this.args.helperId);
    this.theGifts =
      await this. remult.repo(HelperGifts).find({ where: g => g.assignedToHelper.isEqualTo(helper) }).then(
        gifts => {
          return gifts.map(x => {
            if (x.wasConsumed)
              this.giftsUsed += 1
            else
              this.giftsAvailable += 1;
            return {
              giftID: x.id,
              giftUrl: x.giftURL,
              dateGranted: relativeDateName(this.remult, { d: x.dateGranted }),
              wasConsumed: x.wasConsumed,
              wasClicked: x.wasClicked
            }
          })
        }
      );
  }

  async giftUsed(gitfID) {
    await this. remult.repo(HelperGifts).findFirst({ where: g => g.id.isEqualTo(gitfID) }).then(
      async gift => {
        gift.wasConsumed = true;
        await gift.save();
      }
    )
    this.ngOnInit();
  }

  async useTheGift(gitfID) {
    await this. remult.repo(HelperGifts).findFirst({ where: g => g.id.isEqualTo(gitfID) }).then(
      async gift => {
        gift.wasClicked = true;
        await gift.save();
        window.open(gift.giftURL);
      }
    )
    this.ngOnInit();
  }
}
