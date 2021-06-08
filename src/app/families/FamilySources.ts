import { Phone } from "../model-shared/Phone";


import { Context, IdEntity, Entity } from '@remult/core';
import { Roles } from "../auth/roles";

import { DataControl, getValueList } from "@remult/angular";
import { use, Field, FieldType } from "../translate";

@DataControl({
  valueList: context => getValueList(context.for(FamilySources))
})
@FieldType<FamilySources>({
  valueConverter: {
    toJson: x => x != undefined ? x : '',
    fromJson: x => x || x == '' ? x : null
  },
  displayValue: (e, val) => val ? val.name : ''
})
@Entity<FamilySources>({
  key: "FamilySources",
  allowApiRead: context => context.isSignedIn(),
  allowApiCrud: Roles.admin,
  defaultOrderBy: self => self.name
})
export class FamilySources extends IdEntity {
  @Field({ translation: l => l.familySourceName })
  name: string;
  @Field({ translation: l => l.contactPersonName })
  contactPerson: string;
  @Field()
  phone: Phone;

}

