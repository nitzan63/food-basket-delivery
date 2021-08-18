import { Component, OnInit } from '@angular/core';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { Remult, IdEntity } from 'remult';
import { FamilyImage } from '../families/DeiveryImages';
import { FamilyDeliveries } from '../families/FamilyDeliveries';
import { ImageInfo } from '../images/images.component';
import { ApplicationSettings } from '../manage/ApplicationSettings';

@Component({
  selector: 'app-delivery-images',
  templateUrl: './delivery-images.component.html',
  styleUrls: ['./delivery-images.component.css']
})
export class DeliveryImagesComponent implements OnInit {

  constructor(public settings: ApplicationSettings, private remult: Remult) { }
  args: FamilyDeliveries

  images: myImageInfo[];

  async ngOnInit() {
    this.images = await this.args.loadVolunteerImages();
    let familyImages = await this. remult.repo(FamilyImage).find({ where: f => f.familyId.isEqualTo(this.args.family).and(f.imageInDeliveryId.isIn(this.images.map(x => x.entity.id))) });
    for (const i of this.images) {
      i.imageInFamily = familyImages.find(f => f.imageInDeliveryId == i.entity.id);
    }
  }

  async checkedChanged(i: myImageInfo, ce: MatCheckboxChange) {
    if (i.imageInFamily) {
      await i.imageInFamily.delete();
      i.imageInFamily = undefined;
    }
    else {
      i.imageInFamily = await this. remult.repo(FamilyImage).create({
        familyId: this.args.family,
        imageInDeliveryId: i.entity.id, 
        image: i.image
      }).save();
    }
  }
}
interface myImageInfo extends ImageInfo {

  imageInFamily?: FamilyImage

}
