import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Configuration } from '@kibocommerce/rest-sdk';
import { ReturnApi, OrderApi } from '@kibocommerce/rest-sdk/clients/Commerce'
import { EntityModelOfShipment, FulfillmentAPIProductionProfileItem, ShipmentApi } from '@kibocommerce/rest-sdk/clients/Fulfillment'
import { config } from 'dotenv';

interface ExtendedProperty {
  key: string;
  value: string;
}

interface ShipmentWorkflowStateChangedEvent {
  eventId: string;
  extendedProperties: ExtendedProperty[];
  topic: string;
  entityId: string;
  timestamp: string;
  correlationId: string;
  isTest: boolean;
}

const configuration = Configuration.fromEnv()
const shipmentResource = new ShipmentApi(configuration)

export const main = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  const kiboEvent = event.body ? JSON.parse(event.body) : null
  const workflowStateChangeEvent: ShipmentWorkflowStateChangedEvent = kiboEvent

  if (workflowStateChangeEvent) {
    const shipmentNumber = workflowStateChangeEvent.entityId
    const newState = workflowStateChangeEvent.extendedProperties.find(p => p.key == 'newState')

    if (newState?.value == 'COMPLETED') {
      try {
        const shipment = await shipmentResource.getShipment({ shipmentNumber: Number(shipmentNumber) })
        await processShipmentItemsForReturn(shipment)
        console.log(`Processed shipment ${shipmentNumber}`)
      } catch (e) {
        console.error(`Failed to retreive shipment ${shipmentNumber}. Error: ${e}`)
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Function executed successfully!',
    }),
  };

};

async function processShipmentItemsForReturn(shipment: EntityModelOfShipment) {
  const tradeInItems = shipment.items?.filter(i => i?.data?.isTradeInItem)

  if (tradeInItems && tradeInItems?.length != 0) {
    const returnResource = new ReturnApi(configuration)
    const orderResource = new OrderApi(configuration)

    try {
      const order = await orderResource.getOrder({ orderId: shipment.orderId!, responseFields: 'items' })
      const returnPayload = {
        "originalOrderId": shipment.orderId,
        "items": tradeInItems.map(item => {
          return {
            "orderLineId": order.items!.find(i => i.product?.productCode == item.productCode)?.lineId,
            "product": {
              "productCode": item.productCode,
              "isPackagedStandAlone": true
            },
            "reasons": [
              {
                "reason": "Damaged or defective.",  //Can be custom reason
                "quantity": item.quantity
              }
            ],
            "excludeProductExtras": true,
            "returnType": "REFUND",
            "returnNotRequired": false,
            "quantityReceived": 0,
            "quantityShipped": 0,
            "quantityRestockable": 0,
            "quantityRestocked": 0,
            "shipmentItemId": item.lineId,
            "shipmentNumber": shipment.shipmentNumber
          }
        }),
        "returnType": "REFUND",
        "actionRequired": false,
        "isUnified": true,
        "locationCode": process.env.DEFAULT_RETURN_LOCATION_CODE
      }

      await returnResource.createReturn({ _return: returnPayload })
      console.log(`Created return for shipment ${shipment.shipmentNumber}`)
    } catch (e) {
      console.error(`Failed to create return for shipment ${shipment.shipmentNumber}`)
    }

  }
  //if length not zero of filter
  //create return paylaod and send
}
